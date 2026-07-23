import React, { useState } from 'react';
import { Badge } from '../../../../src/components/common/Badge';
import { CylinderAsset, UserRole } from '../../../../src/types';
import { CylinderIdentityEngine } from '../../../../src/services/CylinderIdentityEngine';
import { PrintableQrCard } from '../../../../src/components/common/PrintableQrCard';

interface CylinderDetailsProps {
  qrCodeQuery?: string;
}

export const CylinderDetailsScreen: React.FC<CylinderDetailsProps> = ({ qrCodeQuery = 'SKM-CYL-QR-90182' }) => {
  const [scannedQr] = useState(qrCodeQuery);
  const [viewerRole, setViewerRole] = useState<UserRole | 'PUBLIC'>('CUSTOMER');

  const [cylinder] = useState<CylinderAsset>(() => {
    let item = CylinderIdentityEngine.lookupByQrCode(scannedQr);
    if (!item) {
      item = CylinderIdentityEngine.createPermanentCylinder({
        capacityKg: 12.5,
        tareWeightKg: 14.2,
        ownerType: 'CUSTOMER_OWNED',
        ownerUserId: 'usr-customer-99',
        zonePrefix: 'AWK',
      });
    }
    return item;
  });

  const resolved = CylinderIdentityEngine.resolveCylinderPermissions(
    cylinder.qrCode,
    viewerRole,
    viewerRole === 'PUBLIC' ? undefined : 'usr-active-1'
  );

  return (
    <div style={{ padding: '24px', maxWidth: '900px', margin: '0 auto', fontFamily: 'sans-serif' }}>
      {/* SCAN RESOLUTION HEADER */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div>
          <h2 style={{ margin: 0, color: '#0F172A' }}>Physical Cylinder QR Scanner & Identity Resolver</h2>
          <p style={{ margin: '4px 0 0 0', color: '#64748B', fontSize: '14px' }}>
            Directive 7 — Digital Permanent Record + Branded Printable QR Code Card
          </p>
        </div>

        {/* ROLE SIMULATION TOGGLE */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '12px', color: '#64748B', fontWeight: 600 }}>Simulate Scan As:</span>
          <select
            value={viewerRole}
            onChange={(e) => setViewerRole(e.target.value as any)}
            style={{
              padding: '6px 12px',
              borderRadius: '6px',
              border: '1px solid #CBD5E1',
              fontSize: '13px',
              fontWeight: 600,
            }}
          >
            <option value="PUBLIC">Public Unauthenticated Scan</option>
            <option value="CUSTOMER">Authenticated Customer (Owner)</option>
            <option value="DRIVER">Delivery Driver</option>
            <option value="STATION_ADMIN">Station Attendant</option>
            <option value="ADMIN">System Administrator</option>
          </select>
        </div>
      </div>

      {/* RESOLUTION CONTENT */}
      {resolved.accessLevel === 'PUBLIC' && resolved.publicView ? (
        /* PUBLIC VERIFICATION VIEW (NO PRIVATE INFO EXPOSED) */
        <div
          style={{
            backgroundColor: '#FFFFFF',
            border: '2px solid #2563EB',
            borderRadius: '16px',
            padding: '32px',
            textAlign: 'center',
            boxShadow: '0 4px 12px rgba(0,0,0,0.05)',
          }}
        >
          <Badge variant="success" label="OFFICIAL SKIMA VERIFIED CYLINDER" />
          <h2 style={{ margin: '16px 0 4px 0', fontSize: '28px', color: '#0F172A', fontFamily: 'monospace' }}>
            {resolved.publicView.publicTag}
          </h2>
          <p style={{ margin: '0 0 20px 0', color: '#64748B', fontSize: '14px' }}>
            {resolved.publicView.notice}
          </p>

          <div
            style={{
              display: 'inline-grid',
              gridTemplateColumns: '1fr 1fr 1fr',
              gap: '24px',
              backgroundColor: '#F8FAFC',
              padding: '16px 32px',
              borderRadius: '12px',
              border: '1px solid #E2E8F0',
            }}
          >
            <div>
              <div style={{ fontSize: '12px', color: '#64748B' }}>CAPACITY</div>
              <div style={{ fontSize: '18px', fontWeight: 700, color: '#0F172A' }}>{resolved.publicView.capacityKg} kg</div>
            </div>
            <div>
              <div style={{ fontSize: '12px', color: '#64748B' }}>SAFETY STATUS</div>
              <div style={{ fontSize: '16px', fontWeight: 700, color: '#16A34A' }}>CLEARED</div>
            </div>
            <div>
              <div style={{ fontSize: '12px', color: '#64748B' }}>CUSTODY STATE</div>
              <div style={{ fontSize: '16px', fontWeight: 700, color: '#0F172A' }}>{resolved.publicView.currentStatus}</div>
            </div>
          </div>
        </div>
      ) : (
        /* FULL OPERATIONAL VIEW FOR AUTHENTICATED ROLES */
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: '24px' }}>
          {/* LEFT: FULL ASSET & INSPECTION HISTORY */}
          <div style={{ display: 'grid', gap: '16px' }}>
            <div
              style={{
                backgroundColor: '#FFFFFF',
                border: '1px solid #E2E8F0',
                borderRadius: '12px',
                padding: '20px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <span style={{ fontSize: '12px', fontWeight: 700, color: '#3B82F6', letterSpacing: '0.05em' }}>
                    AUTHENTICATED OPERATIONAL VIEW
                  </span>
                  <h3 style={{ margin: '4px 0 0 0', fontSize: '24px', color: '#0F172A' }}>{cylinder.publicTag}</h3>
                  <p style={{ margin: '4px 0 0 0', color: '#64748B', fontFamily: 'monospace', fontSize: '13px' }}>
                    RESOLVED URL: https://app.skima.com/cylinder/{cylinder.publicTag}
                  </p>
                </div>
                <Badge variant="success" label="SAFETY CLEARED" />
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(4, 1fr)',
                  gap: '12px',
                  marginTop: '20px',
                  backgroundColor: '#F8FAFC',
                  padding: '16px',
                  borderRadius: '8px',
                }}
              >
                <div>
                  <div style={{ fontSize: '12px', color: '#64748B' }}>CAPACITY</div>
                  <div style={{ fontSize: '16px', fontWeight: 700, color: '#0F172A' }}>{cylinder.capacityKg} kg</div>
                </div>
                <div>
                  <div style={{ fontSize: '12px', color: '#64748B' }}>TARE WEIGHT</div>
                  <div style={{ fontSize: '16px', fontWeight: 700, color: '#0F172A' }}>{cylinder.tareWeightKg} kg</div>
                </div>
                <div>
                  <div style={{ fontSize: '12px', color: '#64748B' }}>OWNERSHIP</div>
                  <div style={{ fontSize: '14px', fontWeight: 600, color: '#0F172A' }}>{cylinder.ownerType}</div>
                </div>
                <div>
                  <div style={{ fontSize: '12px', color: '#64748B' }}>CUSTODY</div>
                  <div style={{ fontSize: '14px', fontWeight: 600, color: '#16A34A' }}>{cylinder.currentStatus}</div>
                </div>
              </div>
            </div>

            {/* REFILL & INSPECTION LOGS */}
            <div
              style={{
                backgroundColor: '#FFFFFF',
                border: '1px solid #E2E8F0',
                borderRadius: '12px',
                padding: '20px',
              }}
            >
              <h4 style={{ margin: '0 0 12px 0', color: '#0F172A' }}>Refill & Inspection Log History</h4>
              <div style={{ color: '#64748B', fontSize: '13px' }}>
                All safety inspections and custody handoffs are permanently logged against this cylinder ID.
              </div>
            </div>
          </div>

          {/* RIGHT: BRANDED PRINTABLE QR CODE CARD */}
          <div
            style={{
              backgroundColor: '#FFFFFF',
              border: '1px solid #E2E8F0',
              borderRadius: '12px',
              padding: '20px',
            }}
          >
            <h4 style={{ margin: '0 0 16px 0', color: '#0F172A', textAlign: 'center' }}>
              Printable Physical Label Card
            </h4>
            <PrintableQrCard cylinder={cylinder} />
          </div>
        </div>
      )}
    </div>
  );
};

export default CylinderDetailsScreen;
