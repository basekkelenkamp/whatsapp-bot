'use strict';

const fs = require('fs');

const { JWT } = require('google-auth-library');

const { createLogger } = require('../logger');

const log = createLogger('drive');

const API = 'https://www.googleapis.com/drive/v3/files';
const SCOPES = ['https://www.googleapis.com/auth/drive.readonly'];

/** Drive ids are opaque but always url-safe; anything else is a config typo. */
const ID_PATTERN = /^[A-Za-z0-9_-]{10,}$/;

/** Parents per query. Long `q` strings get rejected, so walk in batches. */
const PARENTS_PER_QUERY = 20;

/** Stops a shortcut loop or a runaway tree from hammering the API. */
const MAX_FOLDERS = 500;

const FIELDS = 'nextPageToken,files(id,name,mimeType,createdTime,webViewLink,parents,owners(displayName),lastModifyingUser(displayName))';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

class DriveError extends Error {}

/**
 * Read-only Drive access for one service account.
 *
 * The Drive API has no recursive listing, so a subtree is walked breadth-first,
 * asking for the children of up to 20 folders per request.
 */
class DriveClient {
    constructor({ credentials }) {
        this.auth = new JWT({
            email: credentials.client_email,
            key: credentials.private_key,
            scopes: SCOPES,
        });
        this.email = credentials.client_email;
    }

    /** Confirms the credentials work and the folder is actually shared with us. */
    async checkAccess(folderId) {
        assertId(folderId, 'folder id');
        const params = new URLSearchParams({ fields: 'id,name,mimeType', supportsAllDrives: 'true' });
        const folder = await this._request(`${API}/${folderId}?${params}`);
        if (folder.mimeType !== FOLDER_MIME) {
            throw new DriveError(`${folderId} is not a folder (${folder.mimeType})`);
        }
        return folder;
    }

    /**
     * Every non-folder file inside `folderId`, at any depth. Each file carries
     * the folder path it was found in, relative to the watched folder.
     */
    async listSubtree(folderId) {
        assertId(folderId, 'folder id');

        const files = [];
        const visited = new Set([folderId]);
        let queue = [{ id: folderId, path: '' }];

        while (queue.length > 0) {
            const batch = queue.splice(0, PARENTS_PER_QUERY);
            const pathByParent = new Map(batch.map((entry) => [entry.id, entry.path]));
            const query = `trashed = false and (${batch.map((entry) => `'${entry.id}' in parents`).join(' or ')})`;

            for (const file of await this._listAll(query)) {
                // A file can sit in several folders; use whichever parent this
                // batch was asking about.
                const parent = (file.parents || []).find((id) => pathByParent.has(id));
                const parentPath = pathByParent.get(parent) ?? '';

                if (file.mimeType === FOLDER_MIME) {
                    if (visited.has(file.id)) continue;
                    if (visited.size >= MAX_FOLDERS) {
                        log.warn(`Stopping at ${MAX_FOLDERS} folders; the tree is deeper than expected`);
                        queue = [];
                        break;
                    }
                    visited.add(file.id);
                    queue.push({ id: file.id, path: parentPath ? `${parentPath}/${file.name}` : file.name });
                } else {
                    files.push({ ...file, folderPath: parentPath });
                }
            }
        }

        log.debug(`Listed ${files.length} file(s) across ${visited.size} folder(s)`);
        return files;
    }

    async _listAll(query) {
        const out = [];
        let pageToken;
        do {
            const params = new URLSearchParams({
                q: query,
                fields: FIELDS,
                pageSize: '1000',
                supportsAllDrives: 'true',
                includeItemsFromAllDrives: 'true',
            });
            if (pageToken) params.set('pageToken', pageToken);

            const page = await this._request(`${API}?${params}`);
            out.push(...(page.files || []));
            pageToken = page.nextPageToken;
        } while (pageToken);
        return out;
    }

    async _request(url) {
        // The library caches the access token and renews it before expiry, so
        // this is a cheap call after the first one.
        const headers = await this.auth.getRequestHeaders(url);
        const response = await fetch(url, { headers, signal: AbortSignal.timeout(60_000) });

        if (!response.ok) {
            const body = await response.text().catch(() => '');
            throw new DriveError(explain(response.status, body, this.email));
        }
        return response.json();
    }
}

/** Turns Google's error bodies into something worth putting in a log. */
function explain(status, body, email) {
    const detail = extractMessage(body);
    if (status === 404) {
        return `Folder not found (404). Share it with ${email} — the service account cannot see it otherwise. ${detail}`;
    }
    if (status === 403) {
        return `Access denied (403). Either the Drive API is not enabled in the Cloud project, or the folder is not shared with ${email}. ${detail}`;
    }
    if (status === 401) {
        return `Credentials rejected (401). Check the service account key. ${detail}`;
    }
    return `Drive API returned ${status}. ${detail}`;
}

function extractMessage(body) {
    try {
        return JSON.parse(body).error?.message || '';
    } catch {
        return body.slice(0, 200);
    }
}

/**
 * Accepts either a raw folder id or the url from Drive's address bar, because
 * pasting the url is the obvious thing to do.
 */
function parseFolderId(value) {
    const raw = String(value || '').trim();
    const fromUrl = raw.match(/\/folders\/([A-Za-z0-9_-]+)/);
    return fromUrl ? fromUrl[1] : raw;
}

function assertId(id, label) {
    if (!ID_PATTERN.test(id)) throw new DriveError(`"${id}" does not look like a Drive ${label}`);
}

/**
 * Loads the service account key, from a file (the sane place for a secret) or
 * from JSON pasted straight into the add-on options.
 */
function loadCredentials({ keyFile, inlineJson }) {
    let raw = String(inlineJson || '').trim();
    let source = 'the service_account_json option';

    if (!raw) {
        if (!keyFile) throw new DriveError('No service account key configured');
        source = keyFile;
        try {
            raw = fs.readFileSync(keyFile, 'utf8');
        } catch (err) {
            throw new DriveError(
                err.code === 'ENOENT'
                    ? `No service account key at ${keyFile}. Copy the JSON key you downloaded from Google Cloud to that path.`
                    : `Cannot read ${keyFile}: ${err.message}`,
            );
        }
    }

    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch (err) {
        throw new DriveError(`${source} does not contain valid JSON: ${err.message}`);
    }

    if (parsed.type !== 'service_account') {
        throw new DriveError(`${source} is not a service account key (type is "${parsed.type || 'missing'}")`);
    }
    for (const field of ['client_email', 'private_key']) {
        if (!parsed[field]) throw new DriveError(`${source} is missing "${field}"`);
    }
    return parsed;
}

module.exports = { DriveClient, DriveError, loadCredentials, parseFolderId };
