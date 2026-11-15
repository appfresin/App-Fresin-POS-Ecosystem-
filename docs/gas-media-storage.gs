const KASIRIN_MEDIA_FOLDER_ID = '1nHjoFWVdrNc9D5qPccBsC3Qr-aA1zcQ6';
const KASIRIN_MEDIA_SPREADSHEET_ID = '1kjarOM5FNQxDScedSeQZugbmaqzaLghBUhrQjBTbHlI';
const KASIRIN_MEDIA_SHEET_NAME = 'media_assets';
const KASIRIN_MEDIA_TOKEN = '';

function doGet(e) {
  try {
    const params = (e && e.parameter) || {};
    const action = String(params.action || 'health');
    if (action === 'list') return json_(listMedia_(params));
    setupMediaSheet_();
    return json_({ ok: true, app: 'Kasirin media storage' });
  } catch (error) {
    return json_({ ok: false, error: String(error.message || error) });
  }
}

function doPost(e) {
  try {
    const payload = parseBody_(e);
    assertToken_(payload.token);
    if (payload.action === 'upload') return json_(uploadMedia_(payload));
    if (payload.action === 'delete') return json_(deleteMedia_(payload));
    return json_({ ok: false, error: 'Action tidak dikenal.' });
  } catch (error) {
    return json_({ ok: false, error: String(error.message || error) });
  }
}

function uploadMedia_(payload) {
  if (!payload.dataBase64) throw new Error('File kosong.');

  const type = safeSlug_(payload.type || 'product');
  const ownerId = String(payload.ownerId || '');
  const fileName = safeFileName_(payload.fileName || 'kasirin-media.png');
  const mimeType = String(payload.mimeType || 'image/png');
  const rootFolder = DriveApp.getFolderById(KASIRIN_MEDIA_FOLDER_ID);
  const mediaFolder = getOrCreateSubfolder_(rootFolder, type);
  const blob = Utilities.newBlob(Utilities.base64Decode(payload.dataBase64), mimeType, fileName);
  const file = mediaFolder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  const now = new Date().toISOString();
  const media = {
    id: Utilities.getUuid(),
    createdAt: now,
    updatedAt: now,
    type,
    ownerId,
    fileName,
    mimeType,
    driveFileId: file.getId(),
    viewUrl: file.getUrl(),
    directUrl: 'https://drive.google.com/uc?export=view&id=' + file.getId(),
    sizeBytes: file.getSize(),
    active: true
  };

  appendMedia_(media);
  return { ok: true, media };
}

function listMedia_(params) {
  const type = String(params.type || '');
  const ownerId = String(params.ownerId || '');
  const rows = mediaRows_(setupMediaSheet_()).filter(function(row) {
    if (String(row.active) !== 'true') return false;
    if (type && row.type !== type) return false;
    if (ownerId && row.owner_id !== ownerId) return false;
    return true;
  });
  return { ok: true, media: rows };
}

function deleteMedia_(payload) {
  const id = String(payload.id || '');
  const driveFileId = String(payload.driveFileId || '');
  if (!id && !driveFileId) throw new Error('ID media wajib diisi.');

  const sheet = setupMediaSheet_();
  const rows = sheet.getDataRange().getValues();
  const headers = rows[0];
  const idIndex = headers.indexOf('id');
  const fileIndex = headers.indexOf('drive_file_id');
  const activeIndex = headers.indexOf('active');
  const updatedIndex = headers.indexOf('updated_at');

  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index];
    if ((id && row[idIndex] === id) || (driveFileId && row[fileIndex] === driveFileId)) {
      sheet.getRange(index + 1, activeIndex + 1).setValue(false);
      sheet.getRange(index + 1, updatedIndex + 1).setValue(new Date().toISOString());
      try {
        DriveApp.getFileById(row[fileIndex]).setTrashed(true);
      } catch (error) {
        // File mungkin sudah tidak ada; metadata tetap dinonaktifkan.
      }
      return { ok: true };
    }
  }

  return { ok: false, error: 'Media tidak ditemukan.' };
}

function setupMediaSheet_() {
  const spreadsheet = SpreadsheetApp.openById(KASIRIN_MEDIA_SPREADSHEET_ID);
  const sheet = spreadsheet.getSheetByName(KASIRIN_MEDIA_SHEET_NAME) || spreadsheet.insertSheet(KASIRIN_MEDIA_SHEET_NAME);
  const headers = [
    'id',
    'created_at',
    'updated_at',
    'type',
    'owner_id',
    'file_name',
    'mime_type',
    'drive_file_id',
    'view_url',
    'direct_url',
    'size_bytes',
    'active'
  ];

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
  } else {
    const currentHeaders = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), headers.length)).getValues()[0];
    headers.forEach(function(header, index) {
      if (currentHeaders[index] !== header) sheet.getRange(1, index + 1).setValue(header);
    });
  }

  return sheet;
}

function appendMedia_(media) {
  const sheet = setupMediaSheet_();
  if (media.ownerId) deactivateOlderMedia_(sheet, media.type, media.ownerId);
  sheet.appendRow([
    media.id,
    media.createdAt,
    media.updatedAt,
    media.type,
    media.ownerId,
    media.fileName,
    media.mimeType,
    media.driveFileId,
    media.viewUrl,
    media.directUrl,
    media.sizeBytes,
    media.active
  ]);
}

function deactivateOlderMedia_(sheet, type, ownerId) {
  const rows = sheet.getDataRange().getValues();
  if (rows.length <= 1) return;
  const headers = rows[0];
  const typeIndex = headers.indexOf('type');
  const ownerIndex = headers.indexOf('owner_id');
  const activeIndex = headers.indexOf('active');
  const updatedIndex = headers.indexOf('updated_at');

  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index];
    if (row[typeIndex] === type && String(row[ownerIndex]) === String(ownerId) && String(row[activeIndex]) === 'true') {
      sheet.getRange(index + 1, activeIndex + 1).setValue(false);
      sheet.getRange(index + 1, updatedIndex + 1).setValue(new Date().toISOString());
    }
  }
}

function mediaRows_(sheet) {
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return [];
  const headers = values[0];
  return values.slice(1).map(function(row) {
    return headers.reduce(function(record, header, index) {
      record[header] = row[index];
      return record;
    }, {});
  });
}

function parseBody_(e) {
  const contents = e && e.postData && e.postData.contents;
  if (!contents) return {};
  try {
    return JSON.parse(contents);
  } catch (error) {
    return (e && e.parameter) || {};
  }
}

function assertToken_(token) {
  if (KASIRIN_MEDIA_TOKEN && token !== KASIRIN_MEDIA_TOKEN) {
    throw new Error('Token media tidak valid.');
  }
}

function getOrCreateSubfolder_(parent, name) {
  const folders = parent.getFoldersByName(name);
  return folders.hasNext() ? folders.next() : parent.createFolder(name);
}

function safeSlug_(value) {
  return String(value || 'media').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'media';
}

function safeFileName_(value) {
  return String(value || 'kasirin-media.png').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 120);
}

function json_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
