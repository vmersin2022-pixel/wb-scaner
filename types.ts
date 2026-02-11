export interface WBOrder {
  id: number; // Order ID (rid)
  stickerId: string; // The barcode string on the WB sticker
  article: string; // nmId (WB Article)
  vendorCode: string; // Vendor/Seller Article
  title: string;
  brand?: string;
  size?: string; // Tech size (e.g. "XL", "42")
  price: number;
  photoUrl: string;
  isSgtinRequired: boolean;
  sgtin?: string; // The linked KIZ
  status: 'pending' | 'done';
}

export interface SupplyStats {
  total: number;
  done: number;
}

export enum AppStep {
  LOGIN = 'LOGIN',
  SCAN_ORDER = 'SCAN_ORDER',
  SCAN_KIZ = 'SCAN_KIZ',
  SUCCESS_FEEDBACK = 'SUCCESS_FEEDBACK',
  ERROR_FEEDBACK = 'ERROR_FEEDBACK',
}

export interface AudioContextType {
  playSuccess: () => void;
  playDoubleSuccess: () => void;
  playError: () => void;
}

export interface ScanResult {
  success: boolean;
  message?: string;
  type?: 'ORDER' | 'KIZ';
  data?: any;
}