/**
 * Temporary migration helper.
 *
 * Add this file to the same Apps Script project as Code.gs, then run
 * exportNetworkCrmForSupabase(). It creates a JSON backup in Google Drive.
 */
function exportNetworkCrmForSupabase() {
  const book = SpreadsheetApp.getActiveSpreadsheet();
  const sheetNames = [
    'People',
    'Memories',
    'Signals',
    'Evidence',
    'Connections',
    'Lists',
    'ListMembers',
    'Events',
    'EventFeedback'
  ];

  const exported = {
    format: 'network-crm-sheets-export',
    version: 1,
    spreadsheet_id: book.getId(),
    spreadsheet_name: book.getName(),
    exported_at: new Date().toISOString(),
    sheets: {}
  };

  sheetNames.forEach(function(name) {
    const sheet = book.getSheetByName(name);
    if (!sheet) {
      exported.sheets[name] = [];
      return;
    }

    const values = sheet.getDataRange().getDisplayValues();
    if (values.length < 2) {
      exported.sheets[name] = [];
      return;
    }

    const headers = values[0].map(String);
    exported.sheets[name] = values.slice(1).map(function(row) {
      const record = {};
      headers.forEach(function(header, index) {
        if (header) record[header] = row[index] || '';
      });
      return record;
    }).filter(function(record) {
      return Object.keys(record).some(function(key) { return record[key] !== ''; });
    });
  });

  const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd-HHmmss');
  const filename = 'network-crm-export-' + stamp + '.json';
  const file = DriveApp.createFile(filename, JSON.stringify(exported), MimeType.PLAIN_TEXT);

  SpreadsheetApp.getUi().alert(
    'Supabase export created in Google Drive.\n\n' +
    filename + '\n\n' +
    'File URL: ' + file.getUrl()
  );

  return {
    filename: filename,
    file_id: file.getId(),
    file_url: file.getUrl(),
    counts: sheetNames.reduce(function(result, name) {
      result[name] = exported.sheets[name].length;
      return result;
    }, {})
  };
}
