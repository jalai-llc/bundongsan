document.addEventListener('alpine:init', function() {
  var F = window.Formulas;
  var D = window.CA_DEFAULTS;

  Alpine.data('bundongsan', function() {
    return {
      // ── Financial Inputs (persisted) ──────────────────────────
      grossAnnualIncome: Alpine.$persist(0).as('fin_grossAnnualIncome'),
      monthlyDebts: Alpine.$persist(0).as('fin_monthlyDebts'),
      monthlyExpenses: Alpine.$persist(0).as('fin_monthlyExpenses'),
      savingsAvailable: Alpine.$persist(0).as('fin_savings'),

      // Loan preferences
      interestRate: Alpine.$persist(6.75).as('fin_interestRate'),
      loanTermYears: Alpine.$persist(30).as('fin_loanTerm'),
      downPaymentPercent: Alpine.$persist(20).as('fin_downPaymentPct'),
      propertyTaxRate: Alpine.$persist(1.25).as('fin_taxRate'),
      closingCostRate: Alpine.$persist(3).as('fin_closingCostRate'),
      isHighCostCounty: Alpine.$persist(true).as('fin_highCost'),

      // ── Buying Power (computed) ───────────────────────────────
      get grossMonthlyIncome() {
        return this.grossAnnualIncome / 12;
      },

      get conformingLimit() {
        return this.isHighCostCounty ? D.conformingLoanLimitHighCost : D.conformingLoanLimit;
      },

      get maxAffordablePrice() {
        var grossMonthly = this.grossMonthlyIncome;
        if (grossMonthly <= 0) return 0;

        var dpPct = this.downPaymentPercent / 100;
        var ccPct = this.closingCostRate / 100;
        var rate = this.interestRate / 100;
        var taxRate = this.propertyTaxRate / 100;
        var insRate = D.homeownersInsuranceRate;

        // Cash constraint: savings must cover down payment + closing
        var cashDenom = dpPct + ccPct;
        var maxPriceByCash = cashDenom > 0 ? this.savingsAvailable / cashDenom : 0;

        // DTI constraint: binary search with percentage-based down payment
        var maxHousingFront = grossMonthly * D.frontEndDTITarget;
        var maxHousingBack = grossMonthly * D.backEndDTITarget - this.monthlyDebts;
        var maxMonthlyHousing = Math.min(maxHousingFront, maxHousingBack);
        if (maxMonthlyHousing <= 0) return 0;

        var lo = 0, hi = 5000000;
        for (var i = 0; i < 50; i++) {
          var mid = (lo + hi) / 2;
          var loan = mid * (1 - dpPct);
          if (loan <= 0) { lo = mid; continue; }
          var piti = F.monthlyPITI(loan, rate, this.loanTermYears, mid * taxRate, mid * insRate);
          var ltv = mid > 0 ? loan / mid : 0;
          var pmi = ltv > 0.8 ? F.monthlyPMI(loan, D.pmiRate) : 0;
          if (piti.total + pmi < maxMonthlyHousing) lo = mid;
          else hi = mid;
        }
        var maxPriceByDTI = Math.floor(lo);

        return Math.min(maxPriceByCash, maxPriceByDTI);
      },

      get monthlyHousingBudget() {
        var grossMonthly = this.grossMonthlyIncome;
        if (grossMonthly <= 0) return 0;
        var frontEnd = grossMonthly * D.frontEndDTITarget;
        var backEnd = grossMonthly * D.backEndDTITarget - this.monthlyDebts;
        return Math.max(0, Math.min(frontEnd, backEnd));
      },

      get hasFinancials() {
        return this.grossAnnualIncome > 0 && this.savingsAvailable > 0;
      },

      // ── Neighborhood State (persisted) ────────────────────────
      neighborhoods: Alpine.$persist([]).as('hood_neighborhoods'),
      seededLoaded: Alpine.$persist(false).as('hood_seededLoaded'),
      sortBy: Alpine.$persist('cashOnCash').as('hood_sortBy'),
      sortDirection: Alpine.$persist('desc').as('hood_sortDirection'),
      filterAffordable: false,
      mode: Alpine.$persist('investment').as('hood_mode'),
      showAddForm: false,

      form: {
        name: '',
        medianPrice: 0,
        expectedRent: 0,
        propertyTaxRate: 1.25,
        monthlyHOA: 0,
        annualInsurance: 1500,
        vacancyRate: 5,
        maintenanceRate: 1,
        managementFee: 0,
        currentRentIfBuying: 0,
        appreciationRate: 3,
      },

      // ── Initialization ────────────────────────────────────────
      init: function() {
        var self = this;
        this.neighborhoods = this.neighborhoods.map(function(n) {
          n.metrics = self.computeMetrics(n);
          return n;
        });
      },

      // ── Neighborhood Methods ──────────────────────────────────
      resetForm: function() {
        this.form = {
          name: '',
          medianPrice: 0,
          expectedRent: 0,
          propertyTaxRate: this.propertyTaxRate,
          monthlyHOA: 0,
          annualInsurance: 1500,
          vacancyRate: 5,
          maintenanceRate: 1,
          managementFee: 0,
          currentRentIfBuying: 0,
          appreciationRate: 3,
        };
      },

      addNeighborhood: function() {
        if (!this.form.name || this.form.medianPrice <= 0) return;
        var n = Object.assign({}, this.form, {
          id: Date.now(),
          downPaymentPercent: this.downPaymentPercent,
          interestRate: this.interestRate,
          loanTermYears: this.loanTermYears,
          closingCostRate: this.closingCostRate,
        });
        n.metrics = this.computeMetrics(n);
        this.neighborhoods.push(n);
        this.resetForm();
        this.showAddForm = false;
      },

      removeNeighborhood: function(id) {
        this.neighborhoods = this.neighborhoods.filter(function(n) { return n.id !== id; });
      },

      loadSeededNeighborhoods: function() {
        if (!window.CA_NEIGHBORHOODS) return;
        var self = this;

        var existingNames = {};
        this.neighborhoods.forEach(function(n) { existingNames[n.name] = true; });

        var counter = 0;
        window.CA_NEIGHBORHOODS.forEach(function(data) {
          if (existingNames[data.name]) return;
          counter++;
          var n = Object.assign({}, data, {
            id: Date.now() + counter,
            downPaymentPercent: self.downPaymentPercent,
            interestRate: self.interestRate,
            loanTermYears: self.loanTermYears,
            closingCostRate: self.closingCostRate,
          });
          n.metrics = self.computeMetrics(n);
          self.neighborhoods.push(n);
        });

        this.seededLoaded = true;
      },

      clearSeededNeighborhoods: function() {
        var seededNames = {};
        if (window.CA_NEIGHBORHOODS) {
          window.CA_NEIGHBORHOODS.forEach(function(n) { seededNames[n.name] = true; });
        }
        this.neighborhoods = this.neighborhoods.filter(function(n) {
          return !seededNames[n.name];
        });
        this.seededLoaded = false;
      },

      recalculateAll: function() {
        var self = this;
        this.neighborhoods = this.neighborhoods.map(function(n) {
          n.downPaymentPercent = self.downPaymentPercent;
          n.interestRate = self.interestRate;
          n.loanTermYears = self.loanTermYears;
          n.closingCostRate = self.closingCostRate;
          n.metrics = self.computeMetrics(n);
          return n;
        });
      },

      computeMetrics: function(n) {
        var annualRent = n.expectedRent * 12;
        var downPayment = n.medianPrice * (n.downPaymentPercent / 100);
        var loan = n.medianPrice - downPayment;
        var annualTax = n.medianPrice * (n.propertyTaxRate / 100);
        var annualMaintenance = n.medianPrice * (n.maintenanceRate / 100);
        var annualManagement = annualRent * (n.managementFee / 100);
        var closingCosts = n.medianPrice * (n.closingCostRate / 100);
        var cashInvested = downPayment + closingCosts;

        var piti = F.monthlyPITI(loan, n.interestRate / 100, n.loanTermYears, annualTax, n.annualInsurance);
        var ltv = n.medianPrice > 0 ? loan / n.medianPrice : 0;
        var pmi = ltv > 0.8 ? F.monthlyPMI(loan, D.pmiRate) : 0;

        var cr = F.capRate(n.medianPrice, annualRent, n.vacancyRate / 100,
          annualTax, n.annualInsurance, annualMaintenance, (n.monthlyHOA || 0) * 12, annualManagement);

        var mCashFlow = F.monthlyCashFlow(n.expectedRent, n.vacancyRate / 100,
          piti.total, pmi, n.monthlyHOA || 0, annualMaintenance / 12, annualManagement / 12);

        var annualCashFlow = mCashFlow * 12;
        var cocReturn = F.cashOnCashReturn(annualCashFlow, cashInvested);
        var grm = F.grossRentMultiplier(n.medianPrice, annualRent);
        var onePercent = F.onePercentRule(n.medianPrice, n.expectedRent);

        var monthlyCostOfOwnership = piti.total + pmi + (n.monthlyHOA || 0) + annualMaintenance / 12;
        var rentVsBuyDiff = monthlyCostOfOwnership - (n.currentRentIfBuying || 0);
        var equityProjection = F.equityProjection(
          n.medianPrice, downPayment, loan,
          n.interestRate / 100, n.loanTermYears, (n.appreciationRate || 3) / 100, 10
        );

        return {
          capRate: cr,
          cashOnCash: cocReturn,
          monthlyCashFlow: mCashFlow,
          grossRentMultiplier: grm,
          onePercentRule: onePercent,
          piti: piti,
          pmi: pmi,
          cashInvested: cashInvested,
          downPayment: downPayment,
          closingCosts: closingCosts,
          monthlyCostOfOwnership: monthlyCostOfOwnership,
          rentVsBuyDiff: rentVsBuyDiff,
          equityProjection: equityProjection,
        };
      },

      // ── Affordability Check ───────────────────────────────────
      checkAffordability: function(n) {
        if (!this.hasFinancials) {
          return { affordable: null, reasons: [] };
        }

        var grossMonthly = this.grossMonthlyIncome;
        var downPayment = n.medianPrice * (n.downPaymentPercent / 100);
        var closingCosts = n.medianPrice * (n.closingCostRate / 100);
        var totalCashNeeded = downPayment + closingCosts;
        var canAffordCash = this.savingsAvailable >= totalCashNeeded;

        var loan = n.medianPrice - downPayment;
        var annualTax = n.medianPrice * (n.propertyTaxRate / 100);
        var piti = F.monthlyPITI(loan, n.interestRate / 100, n.loanTermYears, annualTax, n.annualInsurance);
        var ltv = n.medianPrice > 0 ? loan / n.medianPrice : 0;
        var pmi = ltv > 0.8 ? F.monthlyPMI(loan, D.pmiRate) : 0;
        var totalHousing = piti.total + pmi + (n.monthlyHOA || 0);
        var backEndDTI = F.backEndDTI(totalHousing, this.monthlyDebts, grossMonthly);
        var canAffordDTI = backEndDTI <= D.backEndDTIMax;

        var isJumbo = loan > this.conformingLimit;

        var reasons = [];
        if (!canAffordCash) {
          reasons.push('Need ' + formatCurrency(totalCashNeeded) + ' cash (have ' + formatCurrency(this.savingsAvailable) + ')');
        }
        if (!canAffordDTI) {
          reasons.push('DTI ' + formatPercent(backEndDTI) + ' exceeds ' + formatPercent(D.backEndDTIMax) + ' limit');
        }

        return {
          affordable: canAffordCash && canAffordDTI,
          canAffordCash: canAffordCash,
          canAffordDTI: canAffordDTI,
          totalCashNeeded: totalCashNeeded,
          cashShortfall: Math.max(0, totalCashNeeded - this.savingsAvailable),
          backEndDTI: backEndDTI,
          totalHousing: totalHousing,
          isJumbo: isJumbo,
          reasons: reasons,
        };
      },

      // ── Sorting & Ranking ─────────────────────────────────────
      toggleSort: function(field) {
        if (this.sortBy === field) {
          this.sortDirection = this.sortDirection === 'desc' ? 'asc' : 'desc';
        } else {
          this.sortBy = field;
          this.sortDirection = 'desc';
        }
      },

      get rankedNeighborhoods() {
        var self = this;
        var sortBy = this.sortBy;
        var direction = this.sortDirection;

        // Recompute metrics reactively when financing inputs change
        var list = this.neighborhoods.map(function(n) {
          var updated = Object.assign({}, n, {
            downPaymentPercent: self.downPaymentPercent,
            interestRate: self.interestRate,
            loanTermYears: self.loanTermYears,
            closingCostRate: self.closingCostRate,
          });
          var metrics = self.computeMetrics(updated);
          var affordability = self.checkAffordability(updated);
          return Object.assign({}, updated, { metrics: metrics, affordability: affordability });
        });

        // Filter
        if (this.filterAffordable && this.hasFinancials) {
          list = list.filter(function(n) { return n.affordability.affordable; });
        }

        // Sort
        list.sort(function(a, b) {
          var valA, valB;
          if (sortBy === 'capRate') { valA = a.metrics.capRate; valB = b.metrics.capRate; }
          else if (sortBy === 'cashOnCash') { valA = a.metrics.cashOnCash; valB = b.metrics.cashOnCash; }
          else if (sortBy === 'monthlyCashFlow') { valA = a.metrics.monthlyCashFlow; valB = b.metrics.monthlyCashFlow; }
          else if (sortBy === 'price') { valA = a.medianPrice; valB = b.medianPrice; }
          else { valA = a.metrics.cashOnCash; valB = b.metrics.cashOnCash; }
          return direction === 'desc' ? (valB - valA) : (valA - valB);
        });

        return list;
      },

      get affordableCount() {
        if (!this.hasFinancials) return this.neighborhoods.length;
        var self = this;
        return this.neighborhoods.filter(function(n) {
          return self.checkAffordability(n).affordable;
        }).length;
      },

      // ── Formatting Helpers ────────────────────────────────────
      fmt: function(val) { return formatCurrency(val); },
      pct: function(val) { return formatPercent(val); },
    };
  });
});
