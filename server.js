require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.json());

// Obligatorio en Render para leer la IP real tras el proxy inverso
app.set('trust proxy', true);

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Error: Variables SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY requeridas.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * Endpoint 1: Crear un nuevo enlace de rastreo
 */
app.post('/api/generate-link', async (req, res) => {
  const { targetUrl } = req.body;

  try {
    const destination = targetUrl && targetUrl.trim() !== '' ? targetUrl.trim() : 'https://google.com';

    const { data, error } = await supabase
      .from('ip_tracking')
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
 * Endpoint 2: Enlace de redirección y captura de geolocalización
 */
app.get('/r/:id', async (req, res) => {
  const { id } = req.params;

  const forwarded = req.headers['x-forwarded-for'];
  let clientIp = forwarded ? forwarded.split(',')[0].trim() : req.socket.remoteAddress;

  if (clientIp && clientIp.includes('::ffff:')) {
    clientIp = clientIp.replace('::ffff:', '');
  }

  const userAgent = req.headers['user-agent'] || 'Desconocido';

  try {
    const { data: session, error } = await supabase
      .from('ip_tracking')
      .select('target_url')
      .eq('id', id)
      .single();

    const redirectTarget = (!error && session?.target_url) ? session.target_url : 'https://google.com';

    if (clientIp && clientIp !== '127.0.0.1' && clientIp !== '::1') {
      try {
        const geoResponse = await fetch(`http://ip-api.com/json/${clientIp}?fields=status,country,regionName,city,lat,lon,isp`);
        const geo = await geoResponse.json();

        if (geo.status === 'success') {
          await supabase
            .from('ip_tracking')
            .update({
              ip_address: clientIp,
              city: geo.city,
              region: geo.regionName,
              country: geo.country,
              latitude: geo.lat,
              longitude: geo.lon,
              isp: geo.isp,
              user_agent: userAgent,
              updated_at: new Date().toISOString()
            })
            .eq('id', id);
        }
      } catch (geoErr) {
        console.error('Error resolviendo IP:', geoErr.message);
      }
    }

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
