import { apiGet } from './client';
import { apiSend } from '../features/documents/api';

export type EntityType = 'osek_patur' | 'osek_murshe' | 'company';

export interface BusinessSummary {
  id: number;
  nameEn: string;
  nameHe: string;
  taxId: string | null;
  entityType: EntityType;
  role: 'owner' | 'assistant' | 'accountant';
}

export interface BusinessList {
  current: number;
  businesses: BusinessSummary[];
  /** The types Add business offers. Empty for anyone but an owner. */
  addableTypes: EntityType[];
}

export const fetchBusinesses = () => apiGet<BusinessList>('/businesses');

export interface NewBusinessInput {
  entityType: EntityType;
  nameEn: string;
  nameHe: string;
  taxId: string;
  addressEn: string;
  addressHe?: string | null;
}

export const createBusiness = (input: NewBusinessInput) => apiSend<{ businessId: number }>('POST', '/businesses', input);

export interface Brand {
  id: number;
  business_id: number;
  name_en: string;
  name_he: string;
  tagline_en: string | null;
  tagline_he: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  address_en: string | null;
  address_he: string | null;
  is_default: number;
  active: number;
}

export interface BrandInput {
  nameEn?: string;
  nameHe?: string;
  taglineEn?: string | null;
  taglineHe?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  addressEn?: string | null;
  addressHe?: string | null;
  active?: boolean;
}

export const fetchBrands = () => apiGet<{ brands: Brand[] }>('/businesses/brands');
export const createBrand = (input: BrandInput) => apiSend<{ brands: Brand[] }>('POST', '/businesses/brands', input);
export const updateBrand = (id: number, input: BrandInput) => apiSend<{ brands: Brand[] }>('PATCH', `/businesses/brands/${id}`, input);
