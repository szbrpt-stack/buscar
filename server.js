-- Tabla 1: Enlaces creados
CREATE TABLE IF NOT EXISTS tracking_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    target_url TEXT NOT NULL DEFAULT 'https://google.com',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tabla 2: Registro de cada visita
CREATE TABLE IF NOT EXISTS tracking_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    link_id UUID REFERENCES tracking_links(id) ON DELETE CASCADE,
    ip_address TEXT,
    city TEXT,
    region TEXT,
    country TEXT,
    latitude NUMERIC(10, 7),
    longitude NUMERIC(10, 7),
    isp TEXT,
    user_agent TEXT,
    clicked_at TIMESTAMPTZ DEFAULT NOW()
);
