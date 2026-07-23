import React, { useState } from 'react';
import { CylinderAsset } from '../../../src/types';
import { CylinderIdentityEngine } from '../../../src/services/CylinderIdentityEngine';
import { PrintableQrCard } from '../../../src/components/common/PrintableQrCard';
import { QrBatchExportEngine } from '../../../src/services/QrBatchExportEngine';

export const AdminCylinderManagementPage: React.FC = () => {
  const [cylinders, setCylinders] = useState<CylinderAsset[]>(() => {
    let list = CylinderIdentityEngine.getAllCylinders();
    if (list.length === 0) {
      // Create baseline registered cylinders for demonstration
      const c1 = CylinderIdentityEngine.createPermanentCylinder({
        capacityKg: 12.5,
        tareWeightKg: 14.2,
        ownerType: 'SKIMA_POOL',
        zonePrefix: 'AWK',
      });
      const c2 = CylinderIdentityEngine.createPermanentCylinder({
        capacityKg: 6.0,
        tareWeightKg: 7.5,
        ownerType: 'SKIMA_POOL',
        zonePrefix: 'AWK',
      });
      const c3 = CylinderIdentityEngine.createPermanentCylinder({
        capacityKg: 50.0,
        tareWeightKg: 48.0,
        ownerType: 'STATION_OWNED',
        zonePrefix: 'AWK',
      });
      list = [c1, c2, c3];
    }
    return list;
  });

  const [selectedCylinder, setSelectedCylinder] = useState<CylinderAsset>(cylinders[0]);
  const [newCapacity, setNewCapacity] = useState(12.5);
  const [newTareWeight, setNewTareWeight] = useState(14.0);
  const [newOwnerType, setNewOwnerType] = useState<'SKIMA_POOL' | 'CUSTOMER_OWNED' | 'STATION_OWNED'>('SKIMA_POOL');

  const handleBatchExportPDF = () => {
    const tags = cylinders.map((c) => c.publicTag);
    const batchGrid = QrBatchExportEngine.generateBatchExport(tags);
    alert(`Generated Printable Print Sheet for ${batchGrid.totalCards} Fleet Assets (${batchGrid.rows} Rows x ${batchGrid.columns} Columns).\nReady for high-res PDF export.`);
  };

  const handleExportThermalEscpos = () => {
    const escpos = QrBatchExportEngine.generateEscposThermalSticker({
      cylinderId: selectedCylinder.id,
      publicTag: selectedCylinder.publicTag,
      qrUrl: `https://app.skima.com/cylinder/${selectedCylinder.publicTag}`,
      capacityKg: selectedCylinder.capacityKg,
      tareWeightKg: selectedCylinder.tareWeightKg,
      registeredAt: selectedCylinder.createdAt,
    });
    alert(`Raw ESC/POS Thermal Printer Output generated for ${selectedCylinder.publicTag}:\n\n${escpos}`);
  };

  const handleRegisterNewCylinder = (e: React.FormEvent) => {
    e.preventDefault();
    const created = CylinderIdentityEngine.createPermanentCylinder({
      capacityKg: newCapacity,
      tareWeightKg: newTareWeight,
      ownerType: newOwnerType,
      zonePrefix: 'AWK',
    });
    setCylinders((prev) => [created, ...prev]);
    setSelectedCylinder(created);
  };

  const handleRegenerateArtwork = () => {
    // Keeps underlying UUID constant, updates visual timestamp
    setSelectedCylinder((prev) => ({
      ...prev,
      updatedAt: new Date().toISOString(),
    }));
    alert(`Visual Artwork Regenerated for ${selectedCylinder.publicTag}. Underlying UUID ${selectedCylinder.id} remains permanent.`);
  };

  return (
    <div style={{ backgroundColor: '#F8FAFC', minHeight: '100vh', fontFamily: 'system-ui, sans-serif', padding: '32px' }}>
      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
        {/* PAGE HEADER */}
        <header style={{ marginBottom: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1 style={{ margin: '0 0 4px 0', color: '#0F172A', fontSize: '28px', fontWeight: 800 }}>
              Physical Cylinder QR Code Asset Management
            </h1>
            <p style={{ margin: 0, color: '#64748B', fontSize: '14px' }}>
              Permanent Digital Identity & Print-Ready Branded QR Code Cards (Directive 7 Clarification)
            </p>
          </div>
          <div style={{ display: 'flex', gap: '12px' }}>
            <button
              onClick={handleExportThermalEscpos}
              style={{ backgroundColor: '#475569', color: '#FFF', border: 'none', borderRadius: '8px', padding: '10px 16px', fontWeight: 700, cursor: 'pointer' }}
            >
              Print Thermal Sticker
            </button>
            <button
              onClick={handleBatchExportPDF}
              style={{ backgroundColor: '#10B981', color: '#FFF', border: 'none', borderRadius: '8px', padding: '10px 16px', fontWeight: 700, cursor: 'pointer' }}
            >
              Export Batch Print Sheet
            </button>
          </div>
        </header>


        <div style={{ display: 'grid', gridTemplateColumns: '1fr 400px', gap: '24px' }}>
          {/* LEFT: CYLINDER FLEET TABLE & REGISTRATION FORM */}
          <div style={{ display: 'grid', gap: '24px' }}>
            {/* REGISTER NEW CYLINDER CARD */}
            <div
              style={{
                backgroundColor: '#FFFFFF',
                border: '1px solid #E2E8F0',
                borderRadius: '16px',
                padding: '24px',
                boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
              }}
            >
              <h3 style={{ margin: '0 0 16px 0', color: '#0F172A' }}>Register New LPG Physical Asset</h3>
              <form onSubmit={handleRegisterNewCylinder} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: '12px', alignItems: 'end' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', color: '#64748B', marginBottom: '4px' }}>Capacity (KG)</label>
                  <input
                    type="number"
                    step="0.5"
                    value={newCapacity}
                    onChange={(e) => setNewCapacity(parseFloat(e.target.value) || 12.5)}
                    style={{ width: '100%', padding: '10px', border: '1px solid #CBD5E1', borderRadius: '8px', boxSizing: 'border-box' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', color: '#64748B', marginBottom: '4px' }}>Tare Weight (KG)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={newTareWeight}
                    onChange={(e) => setNewTareWeight(parseFloat(e.target.value) || 14.0)}
                    style={{ width: '100%', padding: '10px', border: '1px solid #CBD5E1', borderRadius: '8px', boxSizing: 'border-box' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', color: '#64748B', marginBottom: '4px' }}>Owner Category</label>
                  <select
                    value={newOwnerType}
                    onChange={(e) => setNewOwnerType(e.target.value as any)}
                    style={{ width: '100%', padding: '10px', border: '1px solid #CBD5E1', borderRadius: '8px', boxSizing: 'border-box' }}
                  >
                    <option value="SKIMA_POOL">Skima Fleet Pool</option>
                    <option value="CUSTOMER_OWNED">Customer Owned</option>
                    <option value="STATION_OWNED">Station Owned</option>
                  </select>
                </div>
                <button
                  type="submit"
                  style={{
                    backgroundColor: '#2563EB',
                    color: '#FFFFFF',
                    border: 'none',
                    borderRadius: '8px',
                    padding: '12px 20px',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  Register Asset & Generate Card
                </button>
              </form>
            </div>

            {/* CYLINDER FLEET TABLE */}
            <div
              style={{
                backgroundColor: '#FFFFFF',
                border: '1px solid #E2E8F0',
                borderRadius: '16px',
                padding: '24px',
                boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
              }}
            >
              <h3 style={{ margin: '0 0 16px 0', color: '#0F172A' }}>Registered Fleet Assets ({cylinders.length})</h3>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px', textAlign: 'left' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #E2E8F0', color: '#64748B' }}>
                    <th style={{ padding: '12px 8px' }}>Cylinder Tag</th>
                    <th style={{ padding: '12px 8px' }}>Capacity</th>
                    <th style={{ padding: '12px 8px' }}>Ownership</th>
                    <th style={{ padding: '12px 8px' }}>Status</th>
                    <th style={{ padding: '12px 8px', textAlign: 'right' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {cylinders.map((cyl) => (
                    <tr
                      key={cyl.id}
                      style={{
                        borderBottom: '1px solid #F1F5F9',
                        backgroundColor: selectedCylinder.id === cyl.id ? '#EFF6FF' : 'transparent',
                      }}
                    >
                      <td style={{ padding: '12px 8px', fontWeight: 700, fontFamily: 'monospace', color: '#0F172A' }}>
                        {cyl.publicTag}
                      </td>
                      <td style={{ padding: '12px 8px' }}>{cyl.capacityKg} kg</td>
                      <td style={{ padding: '12px 8px', fontSize: '12px', color: '#475569' }}>{cyl.ownerType}</td>
                      <td style={{ padding: '12px 8px' }}>
                        <span style={{ backgroundColor: '#DCFCE7', color: '#15803D', fontSize: '11px', padding: '2px 8px', borderRadius: '12px', fontWeight: 700 }}>
                          {cyl.currentStatus}
                        </span>
                      </td>
                      <td style={{ padding: '12px 8px', textAlign: 'right' }}>
                        <button
                          onClick={() => setSelectedCylinder(cyl)}
                          style={{
                            backgroundColor: selectedCylinder.id === cyl.id ? '#2563EB' : '#F1F5F9',
                            color: selectedCylinder.id === cyl.id ? '#FFFFFF' : '#0F172A',
                            border: 'none',
                            borderRadius: '6px',
                            padding: '6px 12px',
                            fontWeight: 600,
                            cursor: 'pointer',
                          }}
                        >
                          {selectedCylinder.id === cyl.id ? 'Viewing Card' : 'Preview QR Card'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* RIGHT: PRINTABLE QR CODE CARD PREVIEW & EXPORT PANEL */}
          <div
            style={{
              backgroundColor: '#FFFFFF',
              border: '1px solid #E2E8F0',
              borderRadius: '16px',
              padding: '24px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
              position: 'sticky',
              top: '32px',
              height: 'fit-content',
            }}
          >
            <h3 style={{ margin: '0 0 16px 0', color: '#0F172A', textAlign: 'center' }}>
              Printable QR Code Card Preview
            </h3>
            
            <PrintableQrCard
              cylinder={selectedCylinder}
              onRegenerateArtwork={handleRegenerateArtwork}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminCylinderManagementPage;
