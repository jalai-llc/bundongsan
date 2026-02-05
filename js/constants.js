// California-specific defaults (2026)
window.CA_DEFAULTS = {
  propertyTaxRate: 0.0125,          // 1.25% effective (Prop 13 base + local assessments)
  conformingLoanLimit: 832750,       // 2026 FHFA baseline
  conformingLoanLimitHighCost: 1249125, // 2026 high-cost areas (SF, LA, OC, etc.)
  closingCostRate: 0.03,            // 3% typical for CA (range: 2-5%)
  pmiRate: 0.007,                   // 0.7% annual mid-range estimate
  homeownersInsuranceRate: 0.0035,  // ~0.35% of home value annually
  defaultInterestRate: 0.0675,      // 6.75% — current CA 30yr average
  defaultLoanTermYears: 30,
  frontEndDTITarget: 0.28,          // Housing / gross income
  backEndDTITarget: 0.36,           // All debts / gross income
  backEndDTIMax: 0.43,              // Absolute max most lenders accept
  vacancyRate: 0.05,                // 5% national avg
  maintenanceRate: 0.01,            // 1% of property value/yr
  managementFee: 0.0,               // 0% — self-managed default
  annualInsurance: 1500,            // CA homeowners avg
  appreciationRate: 0.03,           // 3% CA long-term avg
};

// Comfort level presets for affordability calculation
window.COMFORT_LEVELS = {
  conservative: {
    label: 'Conservative',
    frontEndDTI: 0.25,    // 25% of income to housing
    backEndDTI: 0.33,     // 33% of income to all debts
    bufferRate: 0.15,     // Keep 15% of income as cushion
  },
  standard: {
    label: 'Standard',
    frontEndDTI: 0.28,    // 28% of income to housing
    backEndDTI: 0.36,     // 36% of income to all debts
    bufferRate: 0.10,     // Keep 10% of income as cushion
  },
  aggressive: {
    label: 'Aggressive',
    frontEndDTI: 0.31,    // 31% of income to housing
    backEndDTI: 0.43,     // 43% of income to all debts (max lenders accept)
    bufferRate: 0.05,     // Keep 5% of income as cushion
  },
};
