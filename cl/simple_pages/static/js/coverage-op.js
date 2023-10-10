document.body.addEventListener('htmx:afterRequest', function (event) {
  $('#timeline-body').empty();
});

document.body.addEventListener('htmx:configRequest', function (event) {
  var formData = new URLSearchParams(new FormData(event.srcElement));
  var values = Array.from(formData.values());
  event.detail.parameters = {};
  event.detail.parameters['court_ids'] = values.map(encodeURIComponent).join(',');
  if (values.length === 0) {
    event.preventDefault();
  }
});

document.body.addEventListener('htmx:afterSettle', function (event) {
  var results = JSON.parse(event.detail.xhr.response);
  TimelinesChart()(`#timeline-body`)
    .zQualitative(false)
    .enableOverview(true)
    .leftMargin(150)
    .rightMargin(400)
    .maxHeight(function (d) {
      return 8000;
    })
    .data([results[0]])
    .enableAnimations(false)
    .timeFormat('%Y-%m-%d')
    .sortChrono(false)
    .segmentTooltipContent(function (d) {
      const inputDate = new Date(d.timeRange[0]);
      const year = inputDate.getFullYear();
      const inputDate2 = new Date(d.timeRange[1]);
      const year2 = inputDate2.getFullYear();
      if (d.val) {
        return `${year} - ${year2} <br>${d.val} opinions`;
      } else {
        return `${year} - ${year2}`;
      }
    })
    .onSegmentClick(function (d) {
      window.open(`/?court=${d.data.id}`);
    })
    .refresh()
    .data(results)
    .refresh();

  $('#fullScreenModal').modal('show');
});

$(document).ready(function () {
  $('.btn-default').on('click', function () {
    var circuitName = $(this).text();
    $('#modalLabel').text(circuitName);
  });
});

$(document).ready(function () {
  // Check if the screen size is xs and automatically toggle the collapse accordingly
  if ($(window).width() < 767) {
    $('#federal_courts').collapse('hide');
    $('#state_courts').collapse('hide');
  }
});