-- ==========================================
-- SKIMA PLATFORM FINANCIAL SCHEMA MIGRATION
-- Migration: 20260723030000_financial_platform_schema.sql
-- Architecture: Skima Wallet Platform & Permanent Skima ID (SKM-XXXXXXXX)
-- ZERO Virtual Bank Accounts / NO NUBAN Generation
-- ==========================================

-- 1. ADD PERMANENT SKIMA ID TO PROFILES TABLE
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS skima_id VARCHAR(20) UNIQUE;

-- Create sequence for Skima ID generation if not exists
CREATE SEQUENCE IF NOT EXISTS public.skima_id_seq START WITH 10000001;

-- Function & Trigger to auto-assign permanent SKM-XXXXXXXX ID on new user creation
CREATE OR REPLACE FUNCTION public.generate_skima_id()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.skima_id IS NULL THEN
        NEW.skima_id := 'SKM-' || LPAD(nextval('public.skima_id_seq')::TEXT, 8, '0');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_generate_skima_id ON public.profiles;
CREATE TRIGGER trg_generate_skima_id
BEFORE INSERT ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.generate_skima_id();

-- Backfill any existing profiles missing skima_id
UPDATE public.profiles 
SET skima_id = 'SKM-' || LPAD(nextval('public.skima_id_seq')::TEXT, 8, '0') 
WHERE skima_id IS NULL;

-- 2. COMPANY WALLET TABLE (Platform Fee Retention)
CREATE TABLE IF NOT EXISTS public.company_wallet (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    currency VARCHAR(3) NOT NULL DEFAULT 'NGN',
    available_balance DECIMAL(15, 2) NOT NULL DEFAULT 0.00,
    total_commissions_earned DECIMAL(15, 2) NOT NULL DEFAULT 0.00,
    total_withdrawal_fees_earned DECIMAL(15, 2) NOT NULL DEFAULT 0.00,
    total_lpg_margins_earned DECIMAL(15, 2) NOT NULL DEFAULT 0.00,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Initialize baseline Company Wallet if empty
INSERT INTO public.company_wallet (id, currency, available_balance)
SELECT gen_random_uuid(), 'NGN', 0.00
WHERE NOT EXISTS (SELECT 1 FROM public.company_wallet);

-- 3. WITHDRAWAL REQUESTS TABLE
CREATE TABLE IF NOT EXISTS public.withdrawal_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    wallet_id UUID NOT NULL REFERENCES public.wallets(id) ON DELETE CASCADE,
    amount_ngn DECIMAL(12, 2) NOT NULL,
    fee_ngn DECIMAL(12, 2) NOT NULL DEFAULT 100.00,
    net_payout_ngn DECIMAL(12, 2) NOT NULL,
    bank_name VARCHAR(100) NOT NULL,
    account_number VARCHAR(20) NOT NULL,
    account_name VARCHAR(150) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'REJECTED')),
    provider_name VARCHAR(50) DEFAULT 'PAYSTACK',
    provider_reference VARCHAR(100),
    failure_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMPTZ
);

-- 4. PARTNER VERIFICATIONS TABLE
CREATE TABLE IF NOT EXISTS public.partner_verifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    role VARCHAR(50) NOT NULL CHECK (role IN ('DRIVER', 'STATION_ADMIN', 'MERCHANT')),
    identity_document_type VARCHAR(50) NOT NULL, -- e.g. NIN, BVN, DRIVERS_LICENSE, CAC_REGISTRATION, EPA_PERMIT
    identity_document_number VARCHAR(100) NOT NULL,
    document_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
    ai_risk_score DECIMAL(4, 2) NOT NULL DEFAULT 0.00,
    status VARCHAR(50) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'SUSPENDED')),
    rejection_reason TEXT,
    reviewed_by UUID REFERENCES public.profiles(id),
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ==========================================
-- INDEXES FOR MAXIMUM QUERY PERFORMANCE
-- ==========================================
CREATE INDEX IF NOT EXISTS idx_profiles_skima_id ON public.profiles(skima_id);
CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_user ON public.withdrawal_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_status ON public.withdrawal_requests(status);
CREATE INDEX IF NOT EXISTS idx_partner_verifications_user ON public.partner_verifications(user_id);
CREATE INDEX IF NOT EXISTS idx_partner_verifications_status ON public.partner_verifications(status);

-- ==========================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ==========================================
ALTER TABLE public.company_wallet ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.withdrawal_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_verifications ENABLE ROW LEVEL SECURITY;

-- Company Wallet RLS (Admin Only)
CREATE POLICY "Admins manage company wallet" ON public.company_wallet FOR ALL USING (EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true
));

-- Withdrawal Requests RLS (Users view own, Admins view all)
CREATE POLICY "Users view own withdrawals" ON public.withdrawal_requests FOR SELECT USING (auth.uid() = user_id OR EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true
));
CREATE POLICY "Users create withdrawals" ON public.withdrawal_requests FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Partner Verifications RLS
CREATE POLICY "Users view own verifications" ON public.partner_verifications FOR SELECT USING (auth.uid() = user_id OR EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true
));
CREATE POLICY "Users create verifications" ON public.partner_verifications FOR INSERT WITH CHECK (auth.uid() = user_id);
