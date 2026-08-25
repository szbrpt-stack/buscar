require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.json());

// Permitir resolver la IP real del cliente a través del proxy de Render
app.set('trust proxy', true);

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Error crítico: Se requieren las variables SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * 1. Generar nuevo enlace de redirección
 * Recibe: { "targetUrl": "https://sitio-destino.com" }
 */
app.post('/api/generate-link', async (req, res) => {
  const { targetUrl } = req.body;

  try {
    const destination = targetUrl && targetUrl.trim() !== '' ? targetUrl.trim() : 'https://google.com';

    // Insertar en tracking_links
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
 * 2. Redirección instantánea sin permisos + captura de IP de alta resolución
 */
app.get('/r/:id', async (req, res) => {
  const { id } = req.params;

  // Evitar que el navegador guarde la redirección en caché
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');

  const userAgent = req.headers['user-agent'] || 'Desconocido';

  // Identificar bots automáticos de previsualización (WhatsApp, Telegram, etc.)
  const isBot = /bot|crawl|slurp|spider|mediapartners|whatsapp|telegram|facebookexternalhit|twitterbot/i.test(userAgent);

  // Extraer la IP pública real del dispositivo
  let clientIp = req.headers['cf-connecting-ip'] || 
                 req.headers['x-real-ip'] || 
                 (req.headers['x-forwarded-for'] ? req.headers['x-forwarded-for'].split(',')[0].trim() : req.socket.remoteAddress);

  if (clientIp && clientIp.includes('::ffff:')) {
    clientIp = clientIp.replace('::ffff:', '');
  }

  try {
    // 1. Obtener la URL de destino desde Supabase
    const { data: linkRecord, error } = await supabase
      .from('tracking_links')
      .select('target_url')
      .eq('id', id)
      .single();

    const redirectTarget = (!error && linkRecord?.target_url) ? linkRecord.target_url : 'https://google.com';

    // 2. Resolver geolocalización IP mediante ipwho.is
    if (!isBot && clientIp && clientIp !== '127.0.0.1' && clientIp !== '::1') {
      try {
        const geoResponse = await fetch(`https://ipwho.is/${clientIp}`);
        const geo = await geoResponse.json();

        if (geo.success) {
          await supabase
            .from('tracking_logs')
            .insert([{
              link_id: id,
              ip_address: geo.ip || clientIp,
              city: geo.city,
              region: geo.region,
              country: geo.country,
              latitude: geo.latitude,
              longitude: geo.longitude,
              isp: geo.connection?.isp || geo.connection?.org || 'Desconocido',
              user_agent: userAgent
            }]);
        }
      } catch (geoErr) {
        console.error('Error resolviendo geolocalización IP:', geoErr.message);
      }
    }

    // 3. Redirigir de inmediato al destino sin bloquear al usuario
    return res.redirect(302, redirectTarget);

  } catch (err) {
    console.error('Error procesando redirección:', err.message);
    return res.redirect(302, 'https://google.com');
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor activo en el puerto ${PORT}`);
});
