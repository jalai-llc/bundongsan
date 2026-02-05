document.addEventListener('alpine:init', function() {
  var F = window.Formulas;
  var D = window.CA_DEFAULTS;

  Alpine.data('neighborhoodExplorer', function() {
    return {
      mode: Alpine.$persist('investment').as('hood_mode'),
      neighborhoods: Alpine.$persist([]).as('hood_neighborhoods'),
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
        downPaymentPercent: 20,
        interestRate: 6.75,
        loanTermYears: 30,
        closingCostRate: 3,
        currentRentIfBuying: 0,
        appreciationRate: 3,
      },

      init: function() {
        var self = this;
        this.neighborhoods = this.neighborhoods.map(function(n) {
          n.metrics = self.computeMetrics(n);
          return n;
        });
      },

      resetForm: function() {
        this.form = {
          name: '',
          medianPrice: 0,
          expectedRent: 0,
          propertyTaxRate: 1.25,
          monthlyHOA: 0,
          annualInsurance: 1500,
          vacancyRate: 5,
          maintenanceRate: 1,
          managementFee: 0,
          downPaymentPercent: 20,
          interestRate: 6.75,
          loanTermYears: 30,
          closingCostRate: 3,
          currentRentIfBuying: 0,
          appreciationRate: 3,
        };
      },

      addNeighborhood: function() {
        if (!this.form.name || this.form.medianPrice <= 0) return;
        var n = Object.assign({}, this.form, { id: Date.now() });
        n.metrics = this.computeMetrics(n);
        this.neighborhoods.push(n);
        this.resetForm();
        this.showAddForm = false;
      },

      removeNeighborhood: function(id) {
        this.neighborhoods = this.neighborhoods.filter(function(n) { return n.id !== id; });
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
          annualTax, n.annualInsurance, annualMaintenance, n.monthlyHOA * 12, annualManagement);

        var mCashFlow = F.monthlyCashFlow(n.expectedRent, n.vacancyRate / 100,
          piti.total, pmi, n.monthlyHOA, annualMaintenance / 12, annualManagement / 12);

        var annualCashFlow = mCashFlow * 12;
        var cocReturn = F.cashOnCashReturn(annualCashFlow, cashInvested);
        var grm = F.grossRentMultiplier(n.medianPrice, annualRent);
        var onePercent = F.onePercentRule(n.medianPrice, n.expectedRent);

        var monthlyCostOfOwnership = piti.total + pmi + n.monthlyHOA + annualMaintenance / 12;
        var rentVsBuyDiff = monthlyCostOfOwnership - (n.currentRentIfBuying || 0);
        var equityProjection = F.equityProjection(
          n.medianPrice, downPayment, loan,
          n.interestRate / 100, n.loanTermYears, n.appreciationRate / 100, 10
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

      fmt: function(val) { return formatCurrency(val); },
      pct: function(val) { return formatPercent(val); },
    };
  });
});
