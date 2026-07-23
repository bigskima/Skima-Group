-- ============================================================================
-- SKIMA PLATFORM MODULE EXPANSION
-- Adds production tables for service geography, marketplace, bill payments,
-- notifications, analytics, AI recommendations, escrow records, and settlements.
-- ============================================================================

DO $$ BEGIN
    CREATE TYPE public.marketplace_order_status_enum AS ENUM (
        'CREATED', 'ESCROW_LOCKED', 'ACCEPTED', 'FULFILLED', 'COMPLETED', 'CANCELLED', 'DISPUTED', 'REFUNDED'
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE public.merchant_product_status_enum AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'REJECTED', 'ARCHIVED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE public.settlement_status_enum AS ENUM ('PENDING', 'APPROVED', 'PROCESSING', 'PAID', 'FAILED', 'REVERSED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE public.notification_channel_enum AS ENUM ('IN_APP', 'SMS', 'EMAIL', 'PUSH', 'WHATSAPP');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE public.notification_status_enum AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'FAILED', 'READ');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE public.ai_recommendation_status_enum AS ENUM ('GENERATED', 'REVIEWED', 'APPROVED', 'REJECTED', 'EXPIRED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ============================================================================
-- 1. CONFIGURABLE SERVICE GEOGRAPHY
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.service_areas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(64) UNIQUE NOT NULL,
    country TEXT NOT NULL,
    state TEXT NOT NULL,
    city TEXT NOT NULL,
    name TEXT NOT NULL,
    center_latitude DOUBLE PRECISION NOT NULL,
    center_longitude DOUBLE PRECISION NOT NULL,
    radius_km DECIMAL(8,2) NOT NULL CHECK (radius_km > 0),
    is_active BOOLEAN DEFAULT TRUE NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_service_areas_city ON public.service_areas(country, state, city);
CREATE INDEX IF NOT EXISTS idx_service_areas_active ON public.service_areas(is_active);

ALTER TABLE public.service_areas ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 2. MERCHANT PLATFORM & MARKETPLACE
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.merchants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    public_id VARCHAR(16) UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    description TEXT,
    service_area_id UUID REFERENCES public.service_areas(id),
    verification_status VARCHAR(20) DEFAULT 'PENDING' NOT NULL,
    commission_percent DECIMAL(5,2) DEFAULT 5.00 CHECK (commission_percent >= 0) NOT NULL,
    is_active BOOLEAN DEFAULT FALSE NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.merchant_products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    price DECIMAL(14,2) NOT NULL CHECK (price >= 0),
    currency VARCHAR(8) DEFAULT 'NGN' NOT NULL,
    stock_quantity INTEGER DEFAULT 0 CHECK (stock_quantity >= 0) NOT NULL,
    status public.merchant_product_status_enum DEFAULT 'DRAFT' NOT NULL,
    image_urls TEXT[] DEFAULT ARRAY[]::TEXT[] NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.marketplace_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    public_id VARCHAR(24) UNIQUE NOT NULL,
    customer_id UUID NOT NULL REFERENCES public.profiles(id),
    merchant_id UUID NOT NULL REFERENCES public.merchants(id),
    subtotal DECIMAL(14,2) NOT NULL CHECK (subtotal >= 0),
    delivery_fee DECIMAL(14,2) DEFAULT 0 CHECK (delivery_fee >= 0) NOT NULL,
    total_amount DECIMAL(14,2) NOT NULL CHECK (total_amount > 0),
    currency VARCHAR(8) DEFAULT 'NGN' NOT NULL,
    status public.marketplace_order_status_enum DEFAULT 'CREATED' NOT NULL,
    escrow_status public.escrow_status_enum DEFAULT 'PENDING' NOT NULL,
    delivery_address TEXT,
    metadata JSONB DEFAULT '{}'::jsonb NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.marketplace_order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    marketplace_order_id UUID NOT NULL REFERENCES public.marketplace_orders(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES public.merchant_products(id),
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_price DECIMAL(14,2) NOT NULL CHECK (unit_price >= 0),
    line_total DECIMAL(14,2) NOT NULL CHECK (line_total >= 0),
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_merchants_owner ON public.merchants(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_products_merchant ON public.merchant_products(merchant_id);
CREATE INDEX IF NOT EXISTS idx_marketplace_orders_customer ON public.marketplace_orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_marketplace_orders_merchant ON public.marketplace_orders(merchant_id);

ALTER TABLE public.merchants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.merchant_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketplace_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketplace_order_items ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 3. BILL PAYMENTS
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.bill_providers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_code VARCHAR(64) UNIQUE NOT NULL,
    name TEXT NOT NULL,
    biller_type VARCHAR(32) NOT NULL,
    is_active BOOLEAN DEFAULT TRUE NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.bill_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reference VARCHAR(64) UNIQUE NOT NULL,
    user_id UUID NOT NULL REFERENCES public.profiles(id),
    provider_id UUID REFERENCES public.bill_providers(id),
    biller_type VARCHAR(32) NOT NULL,
    provider_name TEXT NOT NULL,
    customer_identifier TEXT NOT NULL,
    amount DECIMAL(14,2) NOT NULL CHECK (amount > 0),
    currency VARCHAR(8) DEFAULT 'NGN' NOT NULL,
    status VARCHAR(20) DEFAULT 'PENDING' NOT NULL,
    provider_reference TEXT,
    metadata JSONB DEFAULT '{}'::jsonb NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_bill_transactions_user ON public.bill_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_bill_transactions_reference ON public.bill_transactions(reference);

ALTER TABLE public.bill_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bill_transactions ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 4. ESCROW RECORDS & SETTLEMENTS
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.escrow_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_module VARCHAR(32) NOT NULL,
    source_id UUID NOT NULL,
    customer_id UUID NOT NULL REFERENCES public.profiles(id),
    wallet_id UUID NOT NULL REFERENCES public.wallets(id),
    amount DECIMAL(14,2) NOT NULL CHECK (amount > 0),
    currency VARCHAR(8) DEFAULT 'NGN' NOT NULL,
    status public.escrow_status_enum DEFAULT 'LOCKED' NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.settlements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reference VARCHAR(64) UNIQUE NOT NULL,
    source_module VARCHAR(32) NOT NULL,
    source_id UUID NOT NULL,
    beneficiary_user_id UUID NOT NULL REFERENCES public.profiles(id),
    amount DECIMAL(14,2) NOT NULL CHECK (amount > 0),
    currency VARCHAR(8) DEFAULT 'NGN' NOT NULL,
    settlement_type VARCHAR(64) NOT NULL,
    status public.settlement_status_enum DEFAULT 'PENDING' NOT NULL,
    ledger_entry_id UUID REFERENCES public.ledger_entries(id),
    metadata JSONB DEFAULT '{}'::jsonb NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_escrow_records_source ON public.escrow_records(source_module, source_id);
CREATE INDEX IF NOT EXISTS idx_settlements_beneficiary ON public.settlements(beneficiary_user_id);
CREATE INDEX IF NOT EXISTS idx_settlements_source ON public.settlements(source_module, source_id);

ALTER TABLE public.escrow_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settlements ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 5. NOTIFICATIONS, ANALYTICS, AND AI RECOMMENDATIONS
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    channel public.notification_channel_enum DEFAULT 'IN_APP' NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    status public.notification_status_enum DEFAULT 'QUEUED' NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    read_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.analytics_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id UUID REFERENCES public.profiles(id),
    module VARCHAR(32) NOT NULL,
    event_name VARCHAR(96) NOT NULL,
    service_area_id UUID REFERENCES public.service_areas(id),
    metadata JSONB DEFAULT '{}'::jsonb NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.ai_recommendations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_name VARCHAR(64) NOT NULL,
    source_module VARCHAR(32) NOT NULL,
    source_id UUID,
    recommendation JSONB NOT NULL,
    risk_score DECIMAL(5,4) CHECK (risk_score >= 0 AND risk_score <= 1),
    status public.ai_recommendation_status_enum DEFAULT 'GENERATED' NOT NULL,
    reviewed_by UUID REFERENCES public.profiles(id),
    metadata JSONB DEFAULT '{}'::jsonb NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    reviewed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON public.notifications(user_id, status);
CREATE INDEX IF NOT EXISTS idx_analytics_events_module ON public.analytics_events(module, event_name);
CREATE INDEX IF NOT EXISTS idx_ai_recommendations_source ON public.ai_recommendations(source_module, source_id);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_recommendations ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 6. RLS POLICIES
-- ============================================================================

DROP POLICY IF EXISTS "Authenticated users view active service areas" ON public.service_areas;
CREATE POLICY "Authenticated users view active service areas"
    ON public.service_areas FOR SELECT USING (auth.role() = 'authenticated' AND is_active = TRUE);

DROP POLICY IF EXISTS "Users view own merchant profile" ON public.merchants;
CREATE POLICY "Users view own merchant profile"
    ON public.merchants FOR SELECT USING (owner_user_id = auth.uid() OR is_active = TRUE);

DROP POLICY IF EXISTS "Merchant owners manage products" ON public.merchant_products;
CREATE POLICY "Merchant owners manage products"
    ON public.merchant_products FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.merchants
            WHERE merchants.id = merchant_products.merchant_id
            AND merchants.owner_user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "Authenticated users view active products" ON public.merchant_products;
CREATE POLICY "Authenticated users view active products"
    ON public.merchant_products FOR SELECT USING (auth.role() = 'authenticated' AND status = 'ACTIVE');

DROP POLICY IF EXISTS "Users view related marketplace orders" ON public.marketplace_orders;
CREATE POLICY "Users view related marketplace orders"
    ON public.marketplace_orders FOR SELECT USING (
        customer_id = auth.uid()
        OR EXISTS (
            SELECT 1 FROM public.merchants
            WHERE merchants.id = marketplace_orders.merchant_id
            AND merchants.owner_user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "Users view items for related marketplace orders" ON public.marketplace_order_items;
CREATE POLICY "Users view items for related marketplace orders"
    ON public.marketplace_order_items FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.marketplace_orders
            WHERE marketplace_orders.id = marketplace_order_items.marketplace_order_id
            AND (
                marketplace_orders.customer_id = auth.uid()
                OR EXISTS (
                    SELECT 1 FROM public.merchants
                    WHERE merchants.id = marketplace_orders.merchant_id
                    AND merchants.owner_user_id = auth.uid()
                )
            )
        )
    );

DROP POLICY IF EXISTS "Authenticated users view active bill providers" ON public.bill_providers;
CREATE POLICY "Authenticated users view active bill providers"
    ON public.bill_providers FOR SELECT USING (auth.role() = 'authenticated' AND is_active = TRUE);

DROP POLICY IF EXISTS "Users view own bill transactions" ON public.bill_transactions;
CREATE POLICY "Users view own bill transactions"
    ON public.bill_transactions FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users view own escrow records" ON public.escrow_records;
CREATE POLICY "Users view own escrow records"
    ON public.escrow_records FOR SELECT USING (customer_id = auth.uid());

DROP POLICY IF EXISTS "Users view own settlements" ON public.settlements;
CREATE POLICY "Users view own settlements"
    ON public.settlements FOR SELECT USING (beneficiary_user_id = auth.uid());

DROP POLICY IF EXISTS "Users view own notifications" ON public.notifications;
CREATE POLICY "Users view own notifications"
    ON public.notifications FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Authenticated users insert analytics events" ON public.analytics_events;
CREATE POLICY "Authenticated users insert analytics events"
    ON public.analytics_events FOR INSERT WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Admins view AI recommendations" ON public.ai_recommendations;
CREATE POLICY "Admins view AI recommendations"
    ON public.ai_recommendations FOR SELECT USING (
        EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = TRUE)
    );

DROP POLICY IF EXISTS "Admins update system configurations" ON public.system_configurations;
CREATE POLICY "Admins update system configurations"
    ON public.system_configurations FOR UPDATE USING (
        EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = TRUE)
    );

-- ============================================================================
-- 7. SEED CONFIGURATION
-- ============================================================================

INSERT INTO public.service_areas (
    code, country, state, city, name, center_latitude, center_longitude, radius_km, is_active, metadata
) VALUES (
    'NG-AN-AWKA',
    'Nigeria',
    'Anambra',
    'Awka',
    'Awka Launch Zone',
    6.2209,
    7.0671,
    25.00,
    TRUE,
    '{
      "streets": ["Zik Avenue", "Arthur Eze Avenue", "Ifite Road", "Enugu-Onitsha Expressway"],
      "landmarks": ["Aroma Junction", "UNIZIK Temporary Site", "Emma Pharmacy", "Eke Awka Market"],
      "estates": ["Ngozika Estate", "Udoka Estate", "Real Estate Ifite"],
      "local_directions": ["near Aroma Junction", "around UNIZIK temporary site", "before Eke Awka Market", "close to Emma Pharmacy"]
    }'::jsonb
)
ON CONFLICT (code) DO UPDATE SET
    is_active = EXCLUDED.is_active,
    metadata = EXCLUDED.metadata,
    updated_at = NOW();

INSERT INTO public.system_configurations (key, value, description) VALUES
('SUPPORTED_CURRENCIES', '["NGN"]'::jsonb, 'Currencies currently enabled for wallet and settlement'),
('FUTURE_CURRENCIES', '["USD", "USDC"]'::jsonb, 'Currencies intentionally reserved for future expansion'),
('FEATURE_AVAILABILITY', '{
    "lpgLogistics": true,
    "wallet": true,
    "marketplace": true,
    "merchantPlatform": true,
    "billPayments": true,
    "identityVerification": true,
    "escrow": true,
    "settlement": true,
    "notifications": true,
    "analytics": true,
    "adminControlCenter": true,
    "aiOperations": true,
    "usdWallet": false,
    "usdcWallet": false,
    "multiCountry": false
}'::jsonb, 'Feature flags controlled from Admin Control Center'),
('REGISTRATION_AVAILABILITY', '{
    "customer": true,
    "driver": true,
    "merchant": true,
    "stationAdmin": true,
    "pumpAttendant": false
}'::jsonb, 'Registration gates for role unlock workflows'),
('WALLET_LIMITS_NGN', '{
    "minimumFundingAmount": 100,
    "maximumSingleFundingAmount": 500000,
    "dailyOutgoingLimit": 1000000,
    "maximumWalletBalance": 5000000
}'::jsonb, 'Wallet limits for NGN accounts'),
('MAINTENANCE_MODE', 'false'::jsonb, 'Global maintenance mode toggle')
ON CONFLICT (key) DO UPDATE SET
    value = EXCLUDED.value,
    description = EXCLUDED.description,
    updated_at = NOW();
