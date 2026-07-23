/**
 * SKIMA BATCH QR CODE EXPORT & THERMAL PRINT ENGINE
 * Provides bulk generation of branded printable QR cards for cylinder assets,
 * thermal ESC/POS sticker layouts, and multi-card PDF grid print layouts.
 */

import { CylinderIdentityEngine, PrintableCardData } from './CylinderIdentityEngine';

export interface BatchExportItem {
  cylinderId: string;
  publicTag: string;
  qrCode: string;
  cardData: PrintableCardData;
  escposPayload: string;
}

export interface PrintableSheetGrid {
  totalCards: number;
  rows: number;
  columns: number;
  items: BatchExportItem[];
  generatedAt: string;
}

export class QrBatchExportEngine {
  /**
   * Process a list of cylinder tags/UUIDs into a printable sheet grid
   */
  public static generateBatchExport(publicTags: string[]): PrintableSheetGrid {
    const items: BatchExportItem[] = publicTags.map((tag) => {
      const cardData = CylinderIdentityEngine.generatePrintableCardData(tag);
      const escposPayload = this.generateEscposThermalSticker(cardData);

      return {
        cylinderId: `CYL-${tag}`,
        publicTag: tag,
        qrCode: `SKM-CYL-QR-${tag}`,
        cardData,
        escposPayload,
      };
    });

    const columns = 2; // 2 cards per row on standard print sheet
    const rows = Math.ceil(items.length / columns);

    return {
      totalCards: items.length,
      rows,
      columns,
      items,
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Generate ESC/POS raw command buffer for standard 80mm thermal label printers
   */
  public static generateEscposThermalSticker(card: PrintableCardData): string {
    return [
      '[ESC @]', // Initialize printer
      '[ESC a 1]', // Center align
      '--------------------------------',
      '        SKIMA GROUP CYLINDER    ',
      '--------------------------------',
      `TAG: ${card.publicTag}`,
      `CAPACITY: ${card.capacityKg} KG`,
      `TARE: ${card.tareWeightKg} KG`,
      '--------------------------------',
      `[QR_CODE: ${card.qrUrl}]`, // ESC/POS QR code command trigger
      '--------------------------------',
      'Property of Skima Verified Fleet',
      'Scan to view ownership & custody',
      '[GS V 66 0]', // Feed & cut paper
    ].join('\n');
  }
}
