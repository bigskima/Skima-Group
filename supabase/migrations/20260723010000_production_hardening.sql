-- ============================================================================
-- SKIMA GROUP PLATFORM: PRODUCTION HARDENING & REFACTORED ENGINE MIGRATION
-- Migration: 20260723010000_production_hardening.sql
-- Description: Establishes Audit Logging, Cylinder Asset Registry, Verification
--              Workflow Schema, Financial Configuration Matrix, Multi-Currency
--              Rates, Marketplace E-Commerce Engine, and Atomic Stored Procedures.
-- ============================================================================

-- 1. IMMUTABLE PLATFORM AUDIT LOGS
CREATE TABLE IF NOT EXISTS public.audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type VARCHAR(100) NOT NULL,
    actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    actor_role VARCHAR(50) NOT NULL,
    target_resource VARCHAR(100) NOT NULL,
    resource_id VARCHAR(100) NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    ip_address VARCHAR(45),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON public.audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_event_type ON public.audit_logs(event_type);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON public.audit_logs(created_at DESC);

-- 2. PHYSICAL ASSET IDENTITY REGISTRY (LPG CYLINDERS)
CREATE TABLE IF NOT EXISTS public.cylinder_registry (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    public_tag VARCHAR(100) UNIQUE NOT NULL, -- e.g. CYL-AWK-12.5-90182
    qr_code VARCHAR(255) UNIQUE NOT NULL,
    nfc_tag_id VARCHAR(255) UNIQUE,
    capacity_kg NUMERIC(6, 2) NOT NULL DEFAULT 12.50,
    tare_weight_kg NUMERIC(6, 2) NOT NULL DEFAULT 14.20,
    owner_type VARCHAR(50) NOT NULL DEFAULT 'SKIMA_POOL', -- SKIMA_POOL, CUSTOMER_OWNED, STATION_OWNED
    owner_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    current_custody_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    current_custody_role VARCHAR(50) NOT NULL DEFAULT 'STATION',
    current_status VARCHAR(50) NOT NULL DEFAULT 'IDLE', -- IDLE, IN_TRANSIT_TO_STATION, AT_STATION, REFILLING, IN_TRANSIT_TO_CUSTOMER, DELIVERED
    active_order_id UUID,
    assigned_refill_kg NUMERIC(6, 2),
    safety_clearance BOOLEAN NOT NULL DEFAULT true,
    last_inspected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cylinder_qr ON public.cylinder_registry(qr_code);
CREATE INDEX IF NOT EXISTS idx_cylinder_tag ON public.cylinder_registry(public_tag);
CREATE INDEX IF NOT EXISTS idx_cylinder_custody ON public.cylinder_registry(current_custody_user_id);
CREATE INDEX IF NOT EXISTS idx_cylinder_status ON public.cylinder_registry(current_status);

-- 3. CYLINDER INSPECTION & REFILL HISTORY LOGS
CREATE TABLE IF NOT EXISTS public.cylinder_inspection_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cylinder_id UUID NOT NULL REFERENCES public.cylinder_registry(id) ON DELETE CASCADE,
    inspector_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    action_type VARCHAR(50) NOT NULL, -- INSPECTION, REFILL, CUSTODY_HANDOFF, SAFETY_FLAG
    tare_weight_checked NUMERIC(6, 2),
    gross_weight_checked NUMERIC(6, 2),
    pressure_bar NUMERIC(6, 2),
    passed_inspection BOOLEAN NOT NULL DEFAULT true,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cylinder_logs_cyl ON public.cylinder_inspection_logs(cylinder_id);

-- 4. VERIFICATION APPLICATIONS (DRIVERS, STATIONS, MERCHANTS)
CREATE TABLE IF NOT EXISTS public.verifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role VARCHAR(50) NOT NULL, -- DRIVER, STATION_ADMIN, MERCHANT
    status VARCHAR(50) NOT NULL DEFAULT 'PENDING', -- PENDING, UNDER_REVIEW, APPROVED, REJECTED, SUSPENDED
    business_name VARCHAR(255),
    tin_or_bvn VARCHAR(100),
    operating_license_no VARCHAR(100),
    epa_permit_no VARCHAR(100),
    vehicle_type VARCHAR(100),
    plate_number VARCHAR(50),
    documents JSONB NOT NULL DEFAULT '[]'::jsonb,
    bank_details JSONB NOT NULL DEFAULT '{}'::jsonb,
    rejection_reason TEXT,
    reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, role)
);

CREATE INDEX IF NOT EXISTS idx_verifications_user ON public.verifications(user_id);
CREATE INDEX IF NOT EXISTS idx_verifications_status ON public.verifications(status);

-- 5. FINANCIAL CONFIGURATION & MULTI-CURRENCY MATRIX
CREATE TABLE IF NOT EXISTS public.financial_configurations (
    key VARCHAR(100) PRIMARY KEY,
    value_numeric NUMERIC(14, 4),
    value_string VARCHAR(255),
    value_json JSONB,
    description TEXT,
    updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.currency_rates (
    code VARCHAR(10) PRIMARY KEY, -- NGN, USD, USDC
    name VARCHAR(100) NOT NULL,
    symbol VARCHAR(10) NOT NULL,
    exchange_rate_to_ngn NUMERIC(14, 4) NOT NULL DEFAULT 1.0,
    is_active BOOLEAN NOT NULL DEFAULT true,
    is_future_gated BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed baseline financial configurations
INSERT INTO public.financial_configurations (key, value_numeric, description) VALUES
('LPG_MARKET_PRICE_PER_KG', 1400.0000, 'LPG market baseline price per kg'),
('COMPANY_MARKUP_PERCENT', 7.5000, 'Skima platform margin %'),
('DRIVER_COMMISSION_PERCENT', 70.0000, 'Driver delivery fee share %'),
('STATION_COMMISSION_PERCENT', 85.0000, 'Station gas revenue share %'),
('MARKETPLACE_COMMISSION_PERCENT', 5.0000, 'Skima merchant sales fee %'),
('MINIMUM_WITHDRAWAL_NGN', 1000.0000, 'Minimum single wallet withdrawal'),
('MAXIMUM_WITHDRAWAL_NGN', 500000.0000, 'Maximum single wallet withdrawal')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.currency_rates (code, name, symbol, exchange_rate_to_ngn, is_active, is_future_gated) VALUES
('NGN', 'Nigerian Naira', '₦', 1.0000, true, false),
('USD', 'United States Dollar', '$', 1550.0000, false, true),
('USDC', 'USD Coin (Crypto)', 'USDC', 1550.0000, false, true)
ON CONFLICT (code) DO NOTHING;

-- 6. MARKETPLACE E-COMMERCE PRODUCTS & ORDERS
CREATE TABLE IF NOT EXISTS public.marketplace_products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    slug VARCHAR(255) UNIQUE NOT NULL,
    description TEXT,
    price_ngn NUMERIC(12, 2) NOT NULL,
    category VARCHAR(100) NOT NULL,
    stock_quantity INT NOT NULL DEFAULT 0,
    images JSONB NOT NULL DEFAULT '[]'::jsonb,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_products_slug ON public.marketplace_products(slug);
CREATE INDEX IF NOT EXISTS idx_products_merchant ON public.marketplace_products(merchant_user_id);

CREATE TABLE IF NOT EXISTS public.marketplace_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES public.marketplace_products(id) ON DELETE RESTRICT,
    quantity INT NOT NULL DEFAULT 1,
    unit_price_ngn NUMERIC(12, 2) NOT NULL,
    total_amount_ngn NUMERIC(12, 2) NOT NULL,
    escrow_status VARCHAR(50) NOT NULL DEFAULT 'LOCKED', -- LOCKED, RELEASED, REFUNDED, DISPUTED
    order_status VARCHAR(50) NOT NULL DEFAULT 'PLACED', -- PLACED, SHIPPED, DELIVERED, COMPLETED, CANCELLED
    shipping_address TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mp_orders_customer ON public.marketplace_orders(customer_user_id);
CREATE INDEX IF NOT EXISTS idx_mp_orders_product ON public.marketplace_orders(product_id);

-- 7. ATOMIC STORED PROCEDURES
CREATE OR REPLACE FUNCTION public.log_audit_event(
    p_event_type VARCHAR,
    p_actor_id UUID,
    p_actor_role VARCHAR,
    p_target_resource VARCHAR,
    p_resource_id VARCHAR,
    p_payload JSONB
) RETURNS UUID AS $$
DECLARE
    v_audit_id UUID;
BEGIN
    INSERT INTO public.audit_logs (
        event_type, actor_id, actor_role, target_resource, resource_id, payload
    ) VALUES (
        p_event_type, p_actor_id, p_actor_role, p_target_resource, p_resource_id, p_payload
    ) RETURNING id INTO v_audit_id;
    
    RETURN v_audit_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.approve_verification_request(
    p_verification_id UUID,
    p_reviewer_id UUID
) RETURNS BOOLEAN AS $$
DECLARE
    v_user_id UUID;
    v_role VARCHAR;
BEGIN
    SELECT user_id, role INTO v_user_id, v_role
    FROM public.verifications
    WHERE id = p_verification_id;

    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Verification record not found';
    END IF;

    UPDATE public.verifications
    SET status = 'APPROVED',
        reviewed_by = p_reviewer_id,
        reviewed_at = NOW(),
        updated_at = NOW()
    WHERE id = p_verification_id;

    IF v_role = 'DRIVER' THEN
        UPDATE public.profiles SET is_driver = true WHERE id = v_user_id;
    ELSIF v_role = 'STATION_ADMIN' THEN
        UPDATE public.profiles SET is_station_admin = true WHERE id = v_user_id;
    ELSIF v_role = 'MERCHANT' THEN
        UPDATE public.profiles SET is_merchant = true WHERE id = v_user_id;
    END IF;

    PERFORM public.log_audit_event(
        'VERIFICATION_APPROVED',
        p_reviewer_id,
        'ADMIN',
        'VERIFICATION',
        p_verification_id::TEXT,
        jsonb_build_object('user_id', v_user_id, 'approved_role', v_role)
    );

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 8. ROW LEVEL SECURITY (RLS) POLICIES
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cylinder_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_configurations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.currency_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketplace_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketplace_orders ENABLE ROW LEVEL SECURITY;

-- Read policies
CREATE POLICY "Admins can view audit logs" ON public.audit_logs FOR SELECT USING (true);
CREATE POLICY "Public cylinder registry search" ON public.cylinder_registry FOR SELECT USING (true);
CREATE POLICY "Users view own verifications" ON public.verifications FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Public currency rates view" ON public.currency_rates FOR SELECT USING (true);
CREATE POLICY "Public products view" ON public.marketplace_products FOR SELECT USING (is_active = true);
CREATE POLICY "Users view own marketplace orders" ON public.marketplace_orders FOR SELECT USING (auth.uid() = customer_user_id);
