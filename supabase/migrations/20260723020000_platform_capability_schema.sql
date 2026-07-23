-- ==========================================
-- SKIMA PLATFORM CAPABILITY DATABASE MIGRATION
-- Migration: 20260723020000_platform_capability_schema.sql
-- Architecture: Platform Capability over Application Features
-- Zero Hardcoded Locations (Countries -> States -> Cities -> Service Areas -> Polygons)
-- ==========================================

-- 1. COUNTRIES TABLE
CREATE TABLE IF NOT EXISTS public.countries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(3) NOT NULL UNIQUE, -- e.g. NGA, GHA, GBR, USA
    name VARCHAR(100) NOT NULL,
    currency_code VARCHAR(3) NOT NULL DEFAULT 'NGN',
    phone_code VARCHAR(10) NOT NULL DEFAULT '+234',
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. STATES / REGIONS TABLE
CREATE TABLE IF NOT EXISTS public.states (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    country_id UUID NOT NULL REFERENCES public.countries(id) ON DELETE CASCADE,
    code VARCHAR(10) NOT NULL, -- e.g. AN, LA, EN
    name VARCHAR(100) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. CITIES TABLE
CREATE TABLE IF NOT EXISTS public.cities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    state_id UUID NOT NULL REFERENCES public.states(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    center_latitude DECIMAL(10, 8) NOT NULL,
    center_longitude DECIMAL(11, 8) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. SERVICE AREAS TABLE (Managed via Admin Dashboard)
CREATE TABLE IF NOT EXISTS public.service_areas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    city_id UUID NOT NULL REFERENCES public.cities(id) ON DELETE CASCADE,
    code VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(150) NOT NULL,
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. SERVICE ZONE POLYGONS TABLE (GeoJSON Polygon Boundaries & Dynamic Pricing Rules)
CREATE TABLE IF NOT EXISTS public.service_zone_polygons (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    service_area_id UUID NOT NULL REFERENCES public.service_areas(id) ON DELETE CASCADE,
    label VARCHAR(150) NOT NULL,
    polygon_geojson JSONB NOT NULL, -- GeoJSON Feature / Polygon coordinates
    surge_multiplier DECIMAL(4, 2) NOT NULL DEFAULT 1.00,
    base_delivery_fee DECIMAL(12, 2) NOT NULL DEFAULT 500.00,
    per_km_delivery_fee DECIMAL(12, 2) NOT NULL DEFAULT 150.00,
    lpg_company_margin_percent DECIMAL(5, 2) NOT NULL DEFAULT 7.50,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. DISPUTES CAPABILITY TABLE
CREATE TABLE IF NOT EXISTS public.disputes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id VARCHAR(100) NOT NULL,
    order_type VARCHAR(50) NOT NULL CHECK (order_type IN ('LPG_GAS', 'MARKETPLACE')),
    claimant_user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    claimant_role VARCHAR(50) NOT NULL,
    reason VARCHAR(100) NOT NULL,
    description TEXT NOT NULL,
    disputed_amount_ngn DECIMAL(12, 2) NOT NULL,
    refund_amount_ngn DECIMAL(12, 2) DEFAULT 0.00,
    status VARCHAR(50) NOT NULL DEFAULT 'SUBMITTED' CHECK (status IN ('SUBMITTED', 'UNDER_REVIEW', 'RESOLVED_BUYER_REFUND', 'RESOLVED_SELLER_RELEASE', 'REJECTED')),
    evidence_urls JSONB DEFAULT '[]'::jsonb,
    admin_notes TEXT,
    arbitrated_by UUID REFERENCES public.profiles(id),
    arbitrated_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. SYNCHRONIZATION CAPABILITY TABLE (Replaces raw offline mutations)
CREATE TABLE IF NOT EXISTS public.sync_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mutation_id VARCHAR(100) NOT NULL UNIQUE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    device_id VARCHAR(150),
    action_type VARCHAR(100) NOT NULL,
    payload JSONB NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PROCESSED', 'FAILED', 'CONFLICT_RESOLVED')),
    retry_count INT NOT NULL DEFAULT 0,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMPTZ
);

-- 8. AI ORCHESTRATION TELEMETRY TABLE
CREATE TABLE IF NOT EXISTS public.ai_orchestration_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.profiles(id),
    intent VARCHAR(100) NOT NULL,
    target_agent VARCHAR(150) NOT NULL,
    prompt_text TEXT NOT NULL,
    context_payload JSONB DEFAULT '{}'::jsonb,
    confidence_score DECIMAL(4, 3) NOT NULL DEFAULT 0.95,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ==========================================
-- INDEXES FOR MAXIMUM QUERY PERFORMANCE
-- ==========================================
CREATE INDEX IF NOT EXISTS idx_states_country_id ON public.states(country_id);
CREATE INDEX IF NOT EXISTS idx_cities_state_id ON public.cities(state_id);
CREATE INDEX IF NOT EXISTS idx_service_areas_city_id ON public.service_areas(city_id);
CREATE INDEX IF NOT EXISTS idx_service_zone_polygons_area_id ON public.service_zone_polygons(service_area_id);
CREATE INDEX IF NOT EXISTS idx_disputes_order_id ON public.disputes(order_id);
CREATE INDEX IF NOT EXISTS idx_disputes_claimant ON public.disputes(claimant_user_id);
CREATE INDEX IF NOT EXISTS idx_sync_events_user ON public.sync_events(user_id);
CREATE INDEX IF NOT EXISTS idx_sync_events_status ON public.sync_events(status);

-- ==========================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ==========================================
ALTER TABLE public.countries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_areas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_zone_polygons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.disputes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_orchestration_logs ENABLE ROW LEVEL SECURITY;

-- Public Read access for Geography Engine
CREATE POLICY "Public geography read access" ON public.countries FOR SELECT USING (true);
CREATE POLICY "Public states read access" ON public.states FOR SELECT USING (true);
CREATE POLICY "Public cities read access" ON public.cities FOR SELECT USING (true);
CREATE POLICY "Public service areas read access" ON public.service_areas FOR SELECT USING (true);
CREATE POLICY "Public service zone polygons read access" ON public.service_zone_polygons FOR SELECT USING (true);

-- User-scoped access for Disputes
CREATE POLICY "Users view own disputes" ON public.disputes FOR SELECT USING (auth.uid() = claimant_user_id OR EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true
));
CREATE POLICY "Users create disputes" ON public.disputes FOR INSERT WITH CHECK (auth.uid() = claimant_user_id);
CREATE POLICY "Admins update disputes" ON public.disputes FOR UPDATE USING (EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true
));

-- User-scoped access for Sync Events
CREATE POLICY "Users manage own sync events" ON public.sync_events FOR ALL USING (auth.uid() = user_id);

-- Admin read access for AI logs
CREATE POLICY "Admins view AI logs" ON public.ai_orchestration_logs FOR SELECT USING (EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true
));
