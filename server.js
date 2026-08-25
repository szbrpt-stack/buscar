require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.json());

// Permitir resolver la IP real a través del proxy inverso de Render
app.set('trust proxy', true);

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Error: Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * 1. Generar nuevo enlace
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
 * 2. Procesar clic y registrar visita en tracking_logs
 */
app.get('/r/:id', async (req, res) => {
  const { id } = req.params;

  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');

  const forwarded = req.headers['x-forwarded-for'];
  let clientIp = forwarded ? forwarded.split(',')[0].trim() : req.socket.remoteAddress;

  if (clientIp && clientIp.includes('::ffff:')) {
    clientIp = clientIp.replace('::ffff:', '');
  }

  const userAgent = req.headers['user-agent'] || 'Desconocido';

  try {
    const { data: linkRecord, error } = await supabase
      .from('tracking_links')
      .select('target_url')
      .eq('id', id)
      .single();

    const redirectTarget = (!error && linkRecord?.target_url) ? linkRecord.target_url : 'https://google.com';

    let city = null, region = null, country = null, latitude = null, longitude = null, isp = null;

    if (clientIp && clientIp !== '127.0.0.1' && clientIp !== '::1') {
      try {
        const geoResponse = await fetch(`http://ip-api.com/json/${clientIp}?fields=status,country,regionName,city,lat,lon,isp`);
        const geo = await geoResponse.json();

        if (geo.status === 'success') {
          city = geo.city;
          region = geo.regionName;
          country = geo.country;
          latitude = geo.lat;
          longitude = geo.lon;
          isp = geo.isp;
        }
      } catch (geoErr) {
        console.error('Error consultando ip-api:', geoErr.message);
      }
    }

    await supabase
      .from('tracking_logs')
      .insert([{
        link_id: id,
        ip_address: clientIp,
        city,
        region,
        country,
        latitude,
        longitude,
        isp,
        user_agent: userAgent
      }]);

    return res.redirect(302, redirectTarget);

  } catch (err) {
    console.error('Error procesando visita:', err.message);
    return res.redirect(302, 'https://google.com');
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor activo en el puerto ${PORT}`);
});
