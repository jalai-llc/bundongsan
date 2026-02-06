window.Formulas = {
  /**
   * Monthly mortgage payment (Principal & Interest only).
   * M = P * [r(1+r)^n] / [(1+r)^n - 1]
   */
  monthlyMortgagePI: function(principal, annualRate, termYears) {
    if (principal <= 0) return 0;
    var r = annualRate / 12;
    var n = termYears * 12;
    if (r === 0) return principal / n;
    return principal * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
  },

  /** Full PITI payment breakdown. */
  monthlyPITI: function(principal, annualRate, termYears, annualTax, annualInsurance) {
    var pi = this.monthlyMortgagePI(principal, annualRate, termYears);
    var tax = annualTax / 12;
    var insurance = annualInsurance / 12;
    return { principal_interest: pi, tax: tax, insurance: insurance, total: pi + tax + insurance };
  },

  /** Monthly PMI cost (applied when LTV > 80%). */
  monthlyPMI: function(loanAmount, pmiRate) {
    return (loanAmount * pmiRate) / 12;
  },

  /** Front-end DTI = monthly housing costs / gross monthly income. */
  frontEndDTI: function(monthlyHousingCost, grossMonthlyIncome) {
    if (grossMonthlyIncome <= 0) return 0;
    return monthlyHousingCost / grossMonthlyIncome;
  },

  /** Back-end DTI = (monthly housing + all other debts) / gross monthly income. */
  backEndDTI: function(monthlyHousingCost, monthlyDebts, grossMonthlyIncome) {
    if (grossMonthlyIncome <= 0) return 0;
    return (monthlyHousingCost + monthlyDebts) / grossMonthlyIncome;
  },

  /**
   * Max affordable home price via binary search.
   * Iterative because PMI depends on LTV which depends on the price being solved for.
   */
  maxAffordablePrice: function(
    grossMonthlyIncome, monthlyDebts, downPaymentAmount,
    annualRate, termYears, propertyTaxRate, insuranceRate,
    pmiRate, monthlyHOA, frontEndTarget, backEndTarget
  ) {
    var maxHousingFrontEnd = grossMonthlyIncome * frontEndTarget;
    var maxTotalBackEnd = grossMonthlyIncome * backEndTarget;
    var maxHousingBackEnd = maxTotalBackEnd - monthlyDebts;
    var maxMonthlyHousing = Math.min(maxHousingFrontEnd, maxHousingBackEnd) - monthlyHOA;
    if (maxMonthlyHousing <= 0) return 0;

    var lo = 0, hi = 5000000;
    for (var i = 0; i < 50; i++) {
      var mid = (lo + hi) / 2;
      var loan = mid - downPaymentAmount;
      if (loan <= 0) { lo = mid; continue; }
      var piti = this.monthlyPITI(loan, annualRate, termYears, mid * propertyTaxRate, mid * insuranceRate);
      var ltv = loan / mid;
      var pmi = ltv > 0.8 ? this.monthlyPMI(loan, pmiRate) : 0;
      var totalHousing = piti.total + pmi;
      if (totalHousing < maxMonthlyHousing) lo = mid;
      else hi = mid;
    }
    return Math.floor(lo);
  },

  /** Cap Rate = NOI / Purchase Price. */
  capRate: function(purchasePrice, annualGrossRent, vacancyRate, annualTax, annualInsurance, annualMaintenance, annualHOA, annualManagement) {
    if (purchasePrice <= 0) return 0;
    var effectiveGrossIncome = annualGrossRent * (1 - vacancyRate);
    var operatingExpenses = annualTax + annualInsurance + annualMaintenance + annualHOA + annualManagement;
    return (effectiveGrossIncome - operatingExpenses) / purchasePrice;
  },

  /** Cash-on-Cash Return = Annual Pre-Tax Cash Flow / Total Cash Invested. */
  cashOnCashReturn: function(annualCashFlow, totalCashInvested) {
    if (totalCashInvested <= 0) return 0;
    return annualCashFlow / totalCashInvested;
  },

  /** Gross Rent Multiplier = Purchase Price / Annual Gross Rent. */
  grossRentMultiplier: function(purchasePrice, annualGrossRent) {
    if (annualGrossRent <= 0) return Infinity;
    return purchasePrice / annualGrossRent;
  },

  /** 1% Rule: Monthly rent should be >= 1% of purchase price. */
  onePercentRule: function(purchasePrice, monthlyRent) {
    var target = purchasePrice * 0.01;
    return { target: target, actual: monthlyRent, passes: monthlyRent >= target };
  },

  /** Monthly cash flow for a rental property. */
  monthlyCashFlow: function(monthlyRent, vacancyRate, pitiTotal, pmi, monthlyHOA, monthlyMaintenance, monthlyManagement) {
    var effectiveRent = monthlyRent * (1 - vacancyRate);
    var totalExpenses = pitiTotal + pmi + monthlyHOA + monthlyMaintenance + monthlyManagement;
    return effectiveRent - totalExpenses;
  },

  /** Equity projection over N years (appreciation + principal paydown). */
  equityProjection: function(purchasePrice, downPayment, loanAmount, annualRate, termYears, annualAppreciation, years) {
    var projections = [];
    var r = annualRate / 12;
    var monthlyPayment = this.monthlyMortgagePI(loanAmount, annualRate, termYears);
    var remainingBalance = loanAmount;

    for (var year = 1; year <= years; year++) {
      for (var m = 0; m < 12; m++) {
        if (remainingBalance <= 0) break;
        var interestPayment = remainingBalance * r;
        var principalPayment = monthlyPayment - interestPayment;
        remainingBalance = Math.max(0, remainingBalance - principalPayment);
      }
      var homeValue = purchasePrice * Math.pow(1 + annualAppreciation, year);
      var equity = homeValue - remainingBalance;
      var appreciationGain = homeValue - purchasePrice;
      var principalPaid = loanAmount - remainingBalance;
      projections.push({
        year: year,
        homeValue: homeValue,
        remainingBalance: remainingBalance,
        equity: equity,
        appreciationGain: appreciationGain,
        principalPaid: principalPaid,
      });
    }
    return projections;
  },

  /**
   * Total value projection over N years.
   * Combines: appreciation gains + principal paydown + cumulative cash flow.
   * Returns total wealth generated from the investment.
   */
  totalValueProjection: function(purchasePrice, downPayment, loanAmount, annualRate, termYears, annualAppreciation, annualCashFlow, years) {
    var projections = [];
    var r = annualRate / 12;
    var monthlyPayment = this.monthlyMortgagePI(loanAmount, annualRate, termYears);
    var remainingBalance = loanAmount;
    var cumulativeCashFlow = 0;
    var cashInvested = downPayment; // Note: closing costs handled separately

    for (var year = 1; year <= years; year++) {
      for (var m = 0; m < 12; m++) {
        if (remainingBalance <= 0) break;
        var interestPayment = remainingBalance * r;
        var principalPayment = monthlyPayment - interestPayment;
        remainingBalance = Math.max(0, remainingBalance - principalPayment);
      }
      cumulativeCashFlow += annualCashFlow;

      var homeValue = purchasePrice * Math.pow(1 + annualAppreciation, year);
      var appreciationGain = homeValue - purchasePrice;
      var principalPaid = loanAmount - remainingBalance;
      var equity = homeValue - remainingBalance;

      // Total value = equity (if sold) + cash flow collected
      var totalValue = equity + cumulativeCashFlow;
      // Net gain = total value - what you put in
      var netGain = totalValue - cashInvested;
      // Annualized return (simple ROI / years)
      var totalROI = cashInvested > 0 ? (netGain / cashInvested) : 0;
      var annualizedROI = totalROI / year;

      projections.push({
        year: year,
        homeValue: homeValue,
        appreciationGain: appreciationGain,
        principalPaid: principalPaid,
        cumulativeCashFlow: cumulativeCashFlow,
        equity: equity,
        totalValue: totalValue,
        netGain: netGain,
        totalROI: totalROI,
        annualizedROI: annualizedROI,
      });
    }
    return projections;
  },

  /** Closing cost estimate. */
  closingCostEstimate: function(purchasePrice, rate) {
    return purchasePrice * rate;
  },
};
