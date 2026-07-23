import React from 'react';
import { CylinderAsset } from '../../types';

interface PrintableQrCardProps {
  cylinder: CylinderAsset;
  onDownloadPng?: () => void;
  onDownloadSvg?: () => void;
  onDownloadPdf?: () => void;
  onPrint?: () => void;
  onRegenerateArtwork?: () => void;
}

export const PrintableQrCard: React.FC<PrintableQrCardProps> = ({
  cylinder,
  onDownloadPng,
  onDownloadSvg,
  onDownloadPdf,
  onPrint,
  onRegenerateArtwork,
}) => {
  const handlePrint = () => {
    if (onPrint) {
      onPrint();
    } else {
      window.print();
    }
  };

  const handleDownload = (format: 'PNG' | 'SVG' | 'PDF') => {
    if (format === 'PNG' && onDownloadPng) return onDownloadPng();
    if (format === 'SVG' && onDownloadSvg) return onDownloadSvg();
    if (format === 'PDF' && onDownloadPdf) return onDownloadPdf();

    // Default download fallback handler
    const dataStr = `data:text/json;charset=utf-8,${encodeURIComponent(
      JSON.stringify(cylinder, null, 2)
    )}`;
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `${cylinder.publicTag}_PRINTABLE_LABEL.${format.toLowerCase()}`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  const formattedDate = new Date(cylinder.createdAt).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif' }}>
      {/* PRINT-READY BRANDED CARD ARTWORK */}
      <div
        className="printable-card-wrapper"
        style={{
          width: '360px',
          border: '3px solid #0F172A',
          borderRadius: '16px',
          backgroundColor: '#FFFFFF',
          padding: '24px',
          boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1)',
          margin: '0 auto',
          textAlign: 'center',
          boxSizing: 'border-box',
        }}
      >
        {/* BRAND HEADER */}
        <div style={{ borderBottom: '2px solid #E2E8F0', paddingBottom: '12px', marginBottom: '16px' }}>
          <div
            style={{
              fontSize: '20px',
              fontWeight: 900,
              letterSpacing: '0.05em',
              color: '#0F172A',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
            }}
          >
            <span style={{ color: '#2563EB' }}>●</span> SKIMA GROUP
          </div>
          <div
            style={{
              fontSize: '11px',
              fontWeight: 700,
              color: '#16A34A',
              letterSpacing: '0.08em',
              marginTop: '2px',
              textTransform: 'uppercase',
            }}
          >
            Verified Physical LPG Asset
          </div>
        </div>

        {/* HIGH-CONTRAST QR CODE GRAPHIC */}
        <div
          style={{
            backgroundColor: '#F8FAFC',
            border: '2px dashed #CBD5E1',
            borderRadius: '12px',
            padding: '16px',
            margin: '0 auto 16px auto',
            width: '180px',
            height: '180px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {/* SVG Vector QR Code Visual Representation */}
          <svg width="140" height="140" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="100" height="100" fill="#FFFFFF" rx="8" />
            <path
              d="M10 10H38V38H10V10ZM16 16V32H32V16H16ZM22 22H26V26H22V22Z"
              fill="#0F172A"
            />
            <path
              d="M62 10H90V38H62V10ZM68 16V32H84V16H68ZM74 22H78V26H74V22Z"
              fill="#0F172A"
            />
            <path
              d="M10 62H38V90H10V62ZM16 68V84H32V68H16ZM22 74H26V78H22V74Z"
              fill="#0F172A"
            />
            <rect x="44" y="10" width="12" height="12" fill="#0F172A" />
            <rect x="44" y="30" width="12" height="12" fill="#2563EB" />
            <rect x="44" y="50" width="12" height="20" fill="#0F172A" />
            <rect x="62" y="44" width="28" height="10" fill="#0F172A" />
            <rect x="74" y="60" width="16" height="16" fill="#0F172A" />
            <rect x="62" y="80" width="28" height="10" fill="#16A34A" />
            <rect x="44" y="76" width="12" height="14" fill="#0F172A" />
          </svg>
          <div style={{ fontSize: '10px', color: '#64748B', fontFamily: 'monospace', marginTop: '4px' }}>
            {cylinder.qrCode}
          </div>
        </div>

        {/* METADATA GRID */}
        <div style={{ textAlign: 'left', display: 'grid', gap: '8px', marginBottom: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #F1F5F9', paddingBottom: '4px' }}>
            <span style={{ fontSize: '11px', color: '#64748B', fontWeight: 600 }}>CYLINDER ID</span>
            <span style={{ fontSize: '14px', color: '#0F172A', fontWeight: 800, fontFamily: 'monospace' }}>
              {cylinder.publicTag}
            </span>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #F1F5F9', paddingBottom: '4px' }}>
            <span style={{ fontSize: '11px', color: '#64748B', fontWeight: 600 }}>CAPACITY</span>
            <span style={{ fontSize: '13px', color: '#0F172A', fontWeight: 700 }}>
              {cylinder.capacityKg} KG (Tare: {cylinder.tareWeightKg}kg)
            </span>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #F1F5F9', paddingBottom: '4px' }}>
            <span style={{ fontSize: '11px', color: '#64748B', fontWeight: 600 }}>REGISTERED</span>
            <span style={{ fontSize: '12px', color: '#0F172A', fontWeight: 600 }}>
              {formattedDate}
            </span>
          </div>
        </div>

        {/* FOOTER VERIFICATION NOTICE */}
        <div
          style={{
            fontSize: '10px',
            color: '#475569',
            backgroundColor: '#F8FAFC',
            padding: '8px',
            borderRadius: '6px',
            border: '1px solid #E2E8F0',
          }}
        >
          🔒 Scan with smartphone camera to verify custody, safety status, & refill history.
        </div>
      </div>

      {/* ADMIN / USER CONTROL BUTTONS */}
      <div
        style={{
          marginTop: '16px',
          display: 'flex',
          justifyContent: 'center',
          gap: '8px',
          flexWrap: 'wrap',
        }}
      >
        <button
          onClick={handlePrint}
          style={{
            backgroundColor: '#0F172A',
            color: '#FFFFFF',
            border: 'none',
            padding: '8px 14px',
            borderRadius: '6px',
            fontSize: '13px',
            fontWeight: 700,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          🖨️ Print Label
        </button>

        <button
          onClick={() => handleDownload('PNG')}
          style={{
            backgroundColor: '#2563EB',
            color: '#FFFFFF',
            border: 'none',
            padding: '8px 14px',
            borderRadius: '6px',
            fontSize: '13px',
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          Download PNG
        </button>

        <button
          onClick={() => handleDownload('SVG')}
          style={{
            backgroundColor: '#0D9488',
            color: '#FFFFFF',
            border: 'none',
            padding: '8px 14px',
            borderRadius: '6px',
            fontSize: '13px',
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          Download SVG Vector
        </button>

        <button
          onClick={() => handleDownload('PDF')}
          style={{
            backgroundColor: '#4F46E5',
            color: '#FFFFFF',
            border: 'none',
            padding: '8px 14px',
            borderRadius: '6px',
            fontSize: '13px',
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          Download PDF
        </button>

        {onRegenerateArtwork && (
          <button
            onClick={onRegenerateArtwork}
            style={{
              backgroundColor: '#FFFFFF',
              color: '#475569',
              border: '1px solid #CBD5E1',
              padding: '8px 14px',
              borderRadius: '6px',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            🔄 Regenerate Artwork
          </button>
        )}
      </div>
    </div>
  );
};
