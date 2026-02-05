document.addEventListener('alpine:init', function() {
  var F = window.Formulas;
  var D = window.CA_DEFAULTS;

  Alpine.data('budgetCalculator', function() {
    return {
      // Personal inputs (user must fill)
      grossAnnualIncome: Alpine.$persist(0).as('budget_grossAnnualIncome'),
      monthlyDebts: Alpine.$persist(0).as('budget_monthlyDebts'),
      monthlyExpenses: Alpine.$persist(0).as('budget_monthlyExpenses'),
      savingsAvailable: Alpine.$persist(0).as('budget_savings'),
      targetHomePrice: Alpine.$persist(0).as('budget_targetPrice'),

      // Market defaults (pre-filled, editable)
      interestRate: Alpine.$persist(6.75).as('budget_interestRate'),
      loanTermYears: Alpine.$persist(30).as('budget_loanTerm'),
      downPaymentPercent: Alpine.$persist(20).as('budget_downPaymentPct'),
      propertyTaxRate: Alpine.$persist(1.25).as('budget_taxRate'),
      monthlyHOA: Alpine.$persist(0).as('budget_hoa'),
      isHighCostCounty: Alpine.$persist(true).as('budget_highCost'),
      closingCostRate: Alpine.$persist(3).as('budget_closingCostRate'),

      get grossMonthlyIncome() {
        return this.grossAnnualIncome / 12;
      },
      get downPaymentAmount() {
        return this.targetHomePrice * (this.downPaymentPercent / 100);
      },
      get loanAmount() {
        return Math.max(0, this.targetHomePrice - this.downPaymentAmount);
      },
      get ltv() {
        return this.targetHomePrice > 0 ? this.loanAmount / this.targetHomePrice : 0;
      },
      get needsPMI() {
        return this.ltv > 0.8;
      },
      get conformingLimit() {
        return this.isHighCostCounty ? D.conformingLoanLimitHighCost : D.conformingLoanLimit;
      },
      get isJumbo() {
        return this.loanAmount > this.conformingLimit;
      },
      get piti() {
        if (this.targetHomePrice <= 0 || this.loanAmount <= 0) {
          return { principal_interest: 0, tax: 0, insurance: 0, total: 0 };
        }
        return F.monthlyPITI(
          this.loanAmount, this.interestRate / 100, this.loanTermYears,
          this.targetHomePrice * (this.propertyTaxRate / 100),
          this.targetHomePrice * D.homeownersInsuranceRate
        );
      },
      get monthlyPMI() {
        return this.needsPMI ? F.monthlyPMI(this.loanAmount, D.pmiRate) : 0;
      },
      get totalMonthlyHousing() {
        return this.piti.total + this.monthlyPMI + this.monthlyHOA;
      },
      get frontEndDTI() {
        return F.frontEndDTI(this.totalMonthlyHousing, this.grossMonthlyIncome);
      },
      get backEndDTI() {
        return F.backEndDTI(this.totalMonthlyHousing, this.monthlyDebts, this.grossMonthlyIncome);
      },
      get dtiStatus() {
        if (this.frontEndDTI <= 0.28 && this.backEndDTI <= 0.36) return 'excellent';
        if (this.frontEndDTI <= 0.31 && this.backEndDTI <= 0.43) return 'acceptable';
        return 'risky';
      },
      get closingCosts() {
        return F.closingCostEstimate(this.targetHomePrice, this.closingCostRate / 100);
      },
      get totalCashNeeded() {
        return this.downPaymentAmount + this.closingCosts;
      },
      get savingsShortfall() {
        return Math.max(0, this.totalCashNeeded - this.savingsAvailable);
      },
      get monthlyCashFlow() {
        var takeHomePay = this.grossMonthlyIncome * 0.70;
        return takeHomePay - this.totalMonthlyHousing - this.monthlyDebts - this.monthlyExpenses;
      },
      get maxAffordablePrice() {
        if (this.grossMonthlyIncome <= 0) return 0;
        return F.maxAffordablePrice(
          this.grossMonthlyIncome, this.monthlyDebts, this.savingsAvailable,
          this.interestRate / 100, this.loanTermYears,
          this.propertyTaxRate / 100, D.homeownersInsuranceRate,
          D.pmiRate, this.monthlyHOA,
          D.frontEndDTITarget, D.backEndDTITarget
        );
      },

      fmt: function(val) { return formatCurrency(val); },
      pct: function(val) { return formatPercent(val); },
    };
  });
});
