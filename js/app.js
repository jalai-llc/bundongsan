document.addEventListener('alpine:init', function() {
  Alpine.data('app', function() {
    return {
      activeTab: Alpine.$persist('budget').as('app_activeTab'),
    };
  });
});
