-- ============================================================================
-- SKIMA OPERATING SYSTEM FOR COMMERCE AND LOGISTICS
-- PHASE 1: SOVEREIGN DATABASE KERNEL & SECURITY MIGRATION
-- Migration Version: 20260722000000_init_skima_schema.sql
-- ============================================================================

-- 1. EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. DOMAIN ENUMS
DO $$ BEGIN
    CREATE TYPE public.user_status_enum AS ENUM ('ACTIVE', 'SUSPENDED', 'PENDING_VERIFICATION');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE public.wallet_status_enum AS ENUM ('ACTIVE', 'FROZEN', 'CLOSED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE public.transaction_type_enum AS ENUM (
        'DEPOSIT', 'GAS_PAYMENT', 'ESCROW_HOLD', 'ESCROW_RELEASE_STATION', 
        'ESCROW_RELEASE_DRIVER', 'ESCROW_REFUND', 'MARKETPLACE_PAYMENT', 
        'BILL_PAYMENT', 'WITHDRAWAL'
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE public.cylinder_status_enum AS ENUM (
        'IDLE', 'IN_TRANSIT_TO_STATION', 'AT_STATION', 'REFILLED', 'IN_TRANSIT_TO_CUSTOMER'
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE public.gas_order_status_enum AS ENUM (
        'CREATED', 'ESCROW_LOCKED', 'ASSIGNED_TO_DRIVER', 'CYLINDER_PICKED_UP', 
        'DELIVERED_TO_STATION', 'REFILL_COMPLETED', 'RETURN_IN_TRANSIT', 
        'DELIVERED_TO_CUSTOMER', 'COMPLETED', 'CANCELLED', 'DISPUTED'
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE public.escrow_status_enum AS ENUM (
        'PENDING', 'LOCKED', 'PARTIALLY_RELEASED', 'RELEASED', 'REFUNDED'
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ============================================================================
-- 3. CORE USER PROFILES & IDENTITY ENGINE (RBAC)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    public_id VARCHAR(16) UNIQUE NOT NULL,
    full_name TEXT NOT NULL,
    phone_number TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    avatar_url TEXT,
    is_driver BOOLEAN DEFAULT FALSE NOT NULL,
    is_merchant BOOLEAN DEFAULT FALSE NOT NULL,
    is_station_admin BOOLEAN DEFAULT FALSE NOT NULL,
    is_pump_attendant BOOLEAN DEFAULT FALSE NOT NULL,
    is_admin BOOLEAN DEFAULT FALSE NOT NULL,
    status public.user_status_enum DEFAULT 'ACTIVE' NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_profiles_phone ON public.profiles(phone_number);
CREATE INDEX IF NOT EXISTS idx_profiles_public_id ON public.profiles(public_id);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 4. DOUBLE-ENTRY LEDGER & WALLET INFRASTRUCTURE
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.wallets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
    currency VARCHAR(3) DEFAULT 'NGN' NOT NULL,
    balance DECIMAL(14,2) DEFAULT 0.00 CHECK (balance >= 0) NOT NULL,
    locked_balance DECIMAL(14,2) DEFAULT 0.00 CHECK (locked_balance >= 0) NOT NULL,
    status public.wallet_status_enum DEFAULT 'ACTIVE' NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.ledger_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reference VARCHAR(64) UNIQUE NOT NULL,
    transaction_type public.transaction_type_enum NOT NULL,
    source_wallet_id UUID REFERENCES public.wallets(id),
    destination_wallet_id UUID REFERENCES public.wallets(id),
    amount DECIMAL(14,2) NOT NULL CHECK (amount > 0),
    currency VARCHAR(3) DEFAULT 'NGN' NOT NULL,
    status VARCHAR(20) DEFAULT 'COMPLETED' NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ledger_reference ON public.ledger_entries(reference);
CREATE INDEX IF NOT EXISTS idx_ledger_source ON public.ledger_entries(source_wallet_id);
CREATE INDEX IF NOT EXISTS idx_ledger_dest ON public.ledger_entries(destination_wallet_id);

ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger_entries ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 5. CYLINDER ASSETS (PHYSICAL CUSTODY VS OWNERSHIP)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.cylinders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    qr_code VARCHAR(64) UNIQUE NOT NULL,
    owner_user_id UUID NOT NULL REFERENCES public.profiles(id),
    current_custody_user_id UUID NOT NULL REFERENCES public.profiles(id),
    size_kg DECIMAL(5,2) NOT NULL CHECK (size_kg > 0),
    tare_weight_kg DECIMAL(5,2),
    status public.cylinder_status_enum DEFAULT 'IDLE' NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cylinders_qr ON public.cylinders(qr_code);
CREATE INDEX IF NOT EXISTS idx_cylinders_owner ON public.cylinders(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_cylinders_custody ON public.cylinders(current_custody_user_id);

ALTER TABLE public.cylinders ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 6. LPG STATIONS & DRIVERS MODULE
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.lpg_stations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    owner_user_id UUID NOT NULL REFERENCES public.profiles(id),
    address TEXT NOT NULL,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    price_per_kg DECIMAL(10,2) NOT NULL CHECK (price_per_kg > 0),
    available_stock_kg DECIMAL(10,2) DEFAULT 1000.00 CHECK (available_stock_kg >= 0) NOT NULL,
    is_active BOOLEAN DEFAULT TRUE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.station_attendants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    station_id UUID NOT NULL REFERENCES public.lpg_stations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    is_active BOOLEAN DEFAULT TRUE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    UNIQUE(station_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.drivers (
    id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
    vehicle_type VARCHAR(32) NOT NULL,
    license_plate VARCHAR(32) NOT NULL,
    current_latitude DOUBLE PRECISION,
    current_longitude DOUBLE PRECISION,
    is_online BOOLEAN DEFAULT FALSE NOT NULL,
    is_available BOOLEAN DEFAULT TRUE NOT NULL,
    verification_status VARCHAR(20) DEFAULT 'APPROVED' NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

ALTER TABLE public.lpg_stations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.station_attendants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.drivers ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 7. GAS ORDERS & TIMELINE ENGINE
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.gas_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    public_id VARCHAR(16) UNIQUE NOT NULL,
    customer_id UUID NOT NULL REFERENCES public.profiles(id),
    cylinder_id UUID NOT NULL REFERENCES public.cylinders(id),
    station_id UUID REFERENCES public.lpg_stations(id),
    driver_id UUID REFERENCES public.drivers(id),
    quantity_kg DECIMAL(5,2) NOT NULL CHECK (quantity_kg > 0),
    gas_cost DECIMAL(10,2) NOT NULL CHECK (gas_cost >= 0),
    delivery_fee DECIMAL(10,2) NOT NULL CHECK (delivery_fee >= 0),
    total_amount DECIMAL(10,2) NOT NULL CHECK (total_amount > 0),
    status public.gas_order_status_enum DEFAULT 'CREATED' NOT NULL,
    delivery_address TEXT NOT NULL,
    delivery_latitude DOUBLE PRECISION NOT NULL,
    delivery_longitude DOUBLE PRECISION NOT NULL,
    escrow_status public.escrow_status_enum DEFAULT 'PENDING' NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.order_timeline (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES public.gas_orders(id) ON DELETE CASCADE,
    event_type VARCHAR(64) NOT NULL,
    actor_user_id UUID NOT NULL REFERENCES public.profiles(id),
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    photo_url TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_gas_orders_public ON public.gas_orders(public_id);
CREATE INDEX IF NOT EXISTS idx_gas_orders_cust ON public.gas_orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_gas_orders_driver ON public.gas_orders(driver_id);

ALTER TABLE public.gas_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_timeline ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 8. SYSTEM CONFIGURATIONS & AUDIT LOGS
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.system_configurations (
    key VARCHAR(64) PRIMARY KEY,
    value JSONB NOT NULL,
    description TEXT,
    updated_by UUID REFERENCES public.profiles(id),
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id UUID REFERENCES public.profiles(id),
    action VARCHAR(64) NOT NULL,
    target_table VARCHAR(64),
    target_id UUID,
    payload JSONB DEFAULT '{}'::jsonb,
    ip_address TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

ALTER TABLE public.system_configurations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 9. ROW LEVEL SECURITY (RLS) POLICIES (IDEMPOTENT)
-- ============================================================================

-- Profiles Policy
DROP POLICY IF EXISTS "Public profiles viewable by authenticated users" ON public.profiles;
CREATE POLICY "Public profiles viewable by authenticated users" 
    ON public.profiles FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile" 
    ON public.profiles FOR UPDATE USING (auth.uid() = id);

-- Wallets Policy
DROP POLICY IF EXISTS "Users can view own wallet" ON public.wallets;
CREATE POLICY "Users can view own wallet"
    ON public.wallets FOR SELECT USING (auth.uid() = user_id);

-- Ledger Policy
DROP POLICY IF EXISTS "Users view own ledger entries" ON public.ledger_entries;
CREATE POLICY "Users view own ledger entries"
    ON public.ledger_entries FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.wallets 
            WHERE wallets.id IN (source_wallet_id, destination_wallet_id) 
            AND wallets.user_id = auth.uid()
        )
    );

-- Cylinders Policy
DROP POLICY IF EXISTS "Users view cylinders owned or in custody" ON public.cylinders;
CREATE POLICY "Users view cylinders owned or in custody"
    ON public.cylinders FOR SELECT USING (
        auth.uid() = owner_user_id OR auth.uid() = current_custody_user_id
    );

-- Gas Orders Policy
DROP POLICY IF EXISTS "Users view associated gas orders" ON public.gas_orders;
CREATE POLICY "Users view associated gas orders"
    ON public.gas_orders FOR SELECT USING (
        auth.uid() = customer_id OR 
        auth.uid() = driver_id OR 
        EXISTS (SELECT 1 FROM public.lpg_stations WHERE lpg_stations.id = gas_orders.station_id AND lpg_stations.owner_user_id = auth.uid()) OR
        EXISTS (SELECT 1 FROM public.station_attendants WHERE station_attendants.station_id = gas_orders.station_id AND station_attendants.user_id = auth.uid())
    );

-- Timeline Policy
DROP POLICY IF EXISTS "Users view timeline for their orders" ON public.order_timeline;
CREATE POLICY "Users view timeline for their orders"
    ON public.order_timeline FOR SELECT USING (
        EXISTS (SELECT 1 FROM public.gas_orders WHERE gas_orders.id = order_timeline.order_id AND (
            gas_orders.customer_id = auth.uid() OR gas_orders.driver_id = auth.uid()
        ))
    );

-- Config Policy
DROP POLICY IF EXISTS "Configs viewable by authenticated users" ON public.system_configurations;
CREATE POLICY "Configs viewable by authenticated users"
    ON public.system_configurations FOR SELECT USING (auth.role() = 'authenticated');

-- ============================================================================
-- 10. STORED PROCEDURES & ATOMIC TRANSACTIONS
-- ============================================================================

CREATE OR REPLACE FUNCTION public.handle_new_user() 
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, public_id, full_name, phone_number, email)
  VALUES (
    NEW.id,
    'SKM-U-' || UPPER(SUBSTRING(MD5(NEW.id::text) FROM 1 FOR 8)),
    COALESCE(NEW.raw_user_meta_data->>'full_name', 'Skima User'),
    COALESCE(NEW.phone, NEW.raw_user_meta_data->>'phone_number', NEW.id::text),
    NEW.email
  );

  INSERT INTO public.wallets (user_id) VALUES (NEW.id);
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE OR REPLACE FUNCTION public.fund_user_wallet(
    p_user_id UUID,
    p_amount DECIMAL(14,2),
    p_reference TEXT,
    p_gateway_provider TEXT
) RETURNS BOOLEAN AS $$
DECLARE
    v_wallet_id UUID;
    v_current_balance DECIMAL(14,2);
BEGIN
    SELECT id, balance INTO v_wallet_id, v_current_balance
    FROM public.wallets
    WHERE user_id = p_user_id
    FOR UPDATE;

    IF v_wallet_id IS NULL THEN
        RAISE EXCEPTION 'Wallet not found for user %', p_user_id;
    END IF;

    UPDATE public.wallets
    SET balance = balance + p_amount,
        updated_at = NOW()
    WHERE id = v_wallet_id;

    INSERT INTO public.ledger_entries (
        reference, transaction_type, destination_wallet_id, amount, status, metadata
    ) VALUES (
        p_reference,
        'DEPOSIT',
        v_wallet_id,
        p_amount,
        'COMPLETED',
        jsonb_build_object('provider', p_gateway_provider)
    );

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.lock_order_escrow(
    p_customer_id UUID,
    p_order_id UUID,
    p_amount DECIMAL(14,2)
) RETURNS BOOLEAN AS $$
DECLARE
    v_wallet_id UUID;
    v_balance DECIMAL(14,2);
BEGIN
    SELECT id, balance INTO v_wallet_id, v_balance
    FROM public.wallets
    WHERE user_id = p_customer_id
    FOR UPDATE;

    IF v_balance < p_amount THEN
        RAISE EXCEPTION 'Insufficient balance for escrow lock';
    END IF;

    UPDATE public.wallets
    SET balance = balance - p_amount,
        locked_balance = locked_balance + p_amount,
        updated_at = NOW()
    WHERE id = v_wallet_id;

    UPDATE public.gas_orders
    SET escrow_status = 'LOCKED',
        status = 'ESCROW_LOCKED',
        updated_at = NOW()
    WHERE id = p_order_id;

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 11. SEED DATA (LAUNCH COVERAGE: AWKA, ANAMBRA, NIGERIA)
-- ============================================================================

INSERT INTO public.system_configurations (key, value, description) VALUES
('GAS_PRICE_PER_KG_NGN', '1400.00', 'Current price per kg for LPG gas in NGN'),
('DELIVERY_BASE_FEE_NGN', '500.00', 'Base delivery fee in NGN'),
('DELIVERY_PER_KM_FEE_NGN', '150.00', 'Per kilometer fee in NGN'),
('SKIMA_COMMISSION_PERCENT', '5.00', 'Platform revenue commission percentage'),
('ACTIVE_SERVICE_ZONES', '{
    "country": "Nigeria",
    "state": "Anambra",
    "city": "Awka",
    "center_lat": 6.2209,
    "center_lng": 7.0671,
    "radius_km": 25.0
}', 'Active geo-fence service coverage area configuration')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
