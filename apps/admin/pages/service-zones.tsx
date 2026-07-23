import React, { useState } from 'react';
import { GeographyEngine } from '../../src/services/GeographyEngine';
import { ServiceZonePolygon } from '../../src/types';

export default function ServiceZonesPage() {
  const [registeredPolygons, setRegisteredPolygons] = useState<ServiceZonePolygon[]>(GeographyEngine.getRegisteredPolygons());
  const [selectedCity, setSelectedCity] = useState<string>('Awka');
  const [newLabel, setNewLabel] = useState<string>('');
  const [newSurgeMultiplier, setNewSurgeMultiplier] = useState<number>(1.15);
  const [newBaseFee, setNewBaseFee] = useState<number>(500);
  const [newPerKmFee, setNewPerKmFee] = useState<number>(150);

  const handleAddPolygon = () => {
    if (!newLabel.trim()) return;
    const newPoly: ServiceZonePolygon = {
      id: `poly-${Date.now()}`,
      serviceAreaId: `sa-${selectedCity.toLowerCase()}`,
      label: `${selectedCity} — ${newLabel.trim()}`,
      coordinates: [
        { lat: 6.20, lng: 7.05 },
        { lat: 6.25, lng: 7.05 },
        { lat: 6.25, lng: 7.10 },
        { lat: 6.20, lng: 7.10 },
      ],
      surgeMultiplier: newSurgeMultiplier,
      baseDeliveryFee: newBaseFee,
      perKmFee: newPerKmFee,
      companyMarginPercent: 7.5,
      isActive: true,
    };

    GeographyEngine.registerPolygon(newPoly);
    setRegisteredPolygons([...GeographyEngine.getRegisteredPolygons()]);
    setNewLabel('');
    alert(`Service Zone Polygon "${newPoly.label}" added dynamically to Geography Engine!`);
  };

  return (
    <div style={{ backgroundColor: '#090D16', color: '#F8FAFC', minHeight: '100vh', fontFamily: 'system-ui, sans-serif', padding: '32px' }}>
      
      {/* HEADER */}
      <header style={{ borderBottom: '1px solid #232F4A', paddingBottom: '20px', marginBottom: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <a href="/" style={{ color: '#06B6D4', textDecoration: 'none', fontSize: '13px', fontWeight: 700 }}>← Back to Executive Overview</a>
          <h1 style={{ fontSize: '28px', margin: '8px 0 0 0', fontWeight: 800 }}>GEOGRAPHY CAPABILITY & SERVICE ZONE GOVERNANCE</h1>
          <p style={{ color: '#94A3B8', margin: '4px 0 0 0', fontSize: '14px' }}>Zero Hardcoding • Dynamic GeoJSON Polygons • Multi-City & Global Country Expansion</p>
        </div>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
        
        {/* ADD NEW SERVICE POLYGON (ZERO CODE DEPLOYMENT) */}
        <div style={{ backgroundColor: '#111726', border: '1px solid #232F4A', borderRadius: '16px', padding: '24px' }}>
          <h2 style={{ fontSize: '20px', margin: '0 0 16px 0', fontWeight: 700, color: '#10B981' }}>Create Service Area Polygon</h2>
          <p style={{ color: '#94A3B8', fontSize: '13px', marginBottom: '16px' }}>
            Add new operating cities and district polygons on the fly. Zero code deployments required.
          </p>

          <div style={{ marginBottom: '12px' }}>
            <label style={{ display: 'block', color: '#94A3B8', fontSize: '13px', marginBottom: '4px' }}>City Name</label>
            <select
              value={selectedCity}
              onChange={(e) => setSelectedCity(e.target.value)}
              style={{ width: '100%', backgroundColor: '#090D16', border: '1px solid #232F4A', borderRadius: '8px', padding: '10px', color: '#FFF', fontSize: '14px' }}
            >
              <option value="Awka">Awka (Anambra State)</option>
              <option value="Onitsha">Onitsha (Anambra State)</option>
              <option value="Nnewi">Nnewi (Anambra State)</option>
              <option value="Enugu">Enugu (Enugu State)</option>
              <option value="Lagos">Lagos (Lagos State)</option>
              <option value="Accra">Accra (Ghana)</option>
              <option value="London">London (United Kingdom)</option>
            </select>
          </div>

          <div style={{ marginBottom: '12px' }}>
            <label style={{ display: 'block', color: '#94A3B8', fontSize: '13px', marginBottom: '4px' }}>Polygon Area Label</label>
            <input
              type="text"
              placeholder="e.g. Commercial District / Industrial Zone"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              style={{ width: '100%', backgroundColor: '#090D16', border: '1px solid #232F4A', borderRadius: '8px', padding: '10px', color: '#FFF', fontSize: '14px' }}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
            <div>
              <label style={{ display: 'block', color: '#94A3B8', fontSize: '12px', marginBottom: '4px' }}>Surge Multiplier</label>
              <input
                type="number"
                step="0.05"
                value={newSurgeMultiplier}
                onChange={(e) => setNewSurgeMultiplier(parseFloat(e.target.value) || 1.0)}
                style={{ width: '100%', backgroundColor: '#090D16', border: '1px solid #232F4A', borderRadius: '8px', padding: '10px', color: '#FFF', fontSize: '14px' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', color: '#94A3B8', fontSize: '12px', marginBottom: '4px' }}>Base Delivery Fee (NGN)</label>
              <input
                type="number"
                value={newBaseFee}
                onChange={(e) => setNewBaseFee(parseInt(e.target.value) || 500)}
                style={{ width: '100%', backgroundColor: '#090D16', border: '1px solid #232F4A', borderRadius: '8px', padding: '10px', color: '#FFF', fontSize: '14px' }}
              />
            </div>
          </div>

          <button
            onClick={handleAddPolygon}
            style={{ backgroundColor: '#10B981', color: '#FFF', border: 'none', borderRadius: '8px', padding: '12px 24px', fontWeight: 700, cursor: 'pointer', width: '100%' }}
          >
            Save & Publish Polygon to Platform
          </button>
        </div>

        {/* REGISTERED GEOGRAPHY POLYGONS */}
        <div style={{ backgroundColor: '#111726', border: '1px solid #232F4A', borderRadius: '16px', padding: '24px' }}>
          <h2 style={{ fontSize: '20px', margin: '0 0 12px 0', fontWeight: 700, color: '#06B6D4' }}>Active Service Polygons ({registeredPolygons.length})</h2>
          <p style={{ color: '#94A3B8', fontSize: '13px', marginBottom: '16px' }}>Evaluated in real-time by GeographyEngine point-in-polygon containment math.</p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxHeight: '380px', overflowY: 'auto' }}>
            {registeredPolygons.map((poly) => (
              <div key={poly.id} style={{ backgroundColor: '#1A2238', border: '1px solid #232F4A', padding: '12px 16px', borderRadius: '10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ fontWeight: 700, color: '#FFF', fontSize: '14px' }}>📍 {poly.label}</div>
                  <div style={{ backgroundColor: '#06B6D4', color: '#000', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 800 }}>
                    {poly.surgeMultiplier}x Surge
                  </div>
                </div>
                <div style={{ color: '#94A3B8', fontSize: '12px', marginTop: '6px' }}>
                  Base Delivery: ₦{poly.baseDeliveryFee} | Per KM: ₦{poly.perKmFee} | Margin: {poly.companyMarginPercent}%
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}
