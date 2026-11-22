(() => {
  "use strict";

  // SoundSafe & CoverSafe + FRY 60fps Watermark Hook
  if (window.__soundSafeCoverSafeHooked) return;
  window.__soundSafeCoverSafeHooked = true;

  console.info('[HIDZZ] SoundSafe & CoverSafe aktif (selalu ON).');

  // ================= CONFIGURATION & WATERMARK =================
  const MENTION_USERS = [
    { handle: 'itsmefachry', uid: '0', secUid: '', nickname: 'F R Y 60fps' },
    { handle: 'adek.jamannow', uid: '0', secUid: '', nickname: 'Adek Jaman Now' }
  ];
  const PREFIX = '✦ Ekstension by F R Y 60fps ✦ ';
  let resolved = true; // HIDZZ: tidak ada pencarian UID mention (watermark hook ini nonaktif)
  let watermarkEnabled = true;
  let soundSafeEnabled = true;

  function getMentionText(user) {
    return '@' + String(user?.handle || '').replace(/^@/, '');
  }

  function getFullSignature() {
    return PREFIX + MENTION_USERS.map(getMentionText).filter(Boolean).join(' ');
  }

  const sigRegex = /(?:\s*✦?\s*(?:ADJN\s*)?Method\s*by\s*F\s*R\s*Y\s*60fps\s*✦?(?:\s*(?:<m[^>]*>)?\s*@[A-Za-z0-9._]+\s*(?:<\/m>)?)+)/gi;
  const prefixRegex = /(?:\s*✦?\s*(?:ADJN\s*)?(?:Method|Ekstension)\s*by\s*F\s*R\s*Y\s*60fps\s*✦?\s*)/gi;

  // HIDZZ: watermark bawaan hook ini dimatikan permanen (tanda tangan caption diurus page-hook.js).
  function isWatermarkActive() { return false; }

  // HIDZZ: SoundSafe & CoverSafe selalu aktif, tanpa tombol/toggle.
  function isSoundSafeActive() { return true; }

  window.addEventListener('message', event => {
    const data = event.data;
    if (data && data.source === 'ADJN_METHOD' && data.type === 'ADJN_SETTINGS' && data.settings) {
      if (data.settings.watermarkEnabled !== undefined) {
        watermarkEnabled = !!data.settings.watermarkEnabled;
      }
      if (data.settings.soundSafeEnabled !== undefined) {
        soundSafeEnabled = !!data.settings.soundSafeEnabled;
      }
    }
  });

  // ================= MENTION & UID RESOLUTION =================
  async function resolveMention() {
    if (resolved) return;
    try {
      await Promise.all(MENTION_USERS.map(async user => {
        if (!user || !user.handle) return;
        try {
          const endpoints = [
            '/api/upload/search/user/?aid=1988&keyword=' + encodeURIComponent(user.handle),
            '/api/search/user/full/?aid=1988&keyword=' + encodeURIComponent(user.handle)
          ];
          for (const ep of endpoints) {
            try {
              const res = await fetch(ep, {
                credentials: 'include',
                headers: { 'Accept': 'application/json' }
              });
              if (!res.ok) continue;
              const json = await res.json();
              const userList = json?.user_list || json?.data?.user_list || json?.user_list_info || [];
              let found = null;
              for (const item of userList) {
                const u = item?.user_info || item?.user || item;
                const uname = String(u?.unique_id || u?.uniqueId || '').toLowerCase();
                if (uname === String(user.handle).toLowerCase()) {
                  found = u;
                  break;
                }
              }
              if (!found && userList.length) {
                const first = userList[0]?.user_info || userList[0]?.user || userList[0];
                const uname = String(first?.unique_id || first?.uniqueId || '').toLowerCase();
                if (uname === String(user.handle).toLowerCase()) found = first;
              }
              if (found) {
                const uid = found.uid || found.user_id || found.id;
                const secUid = found.sec_uid || found.secUid || found.sec_user_id || '';
                const uniqueId = found.unique_id || found.uniqueId;
                const nickname = found.nickname || found.screen_name || found.unique_id || '';
                if (uid) user.uid = String(uid);
                if (secUid) user.secUid = String(secUid);
                if (uniqueId) user.handle = String(uniqueId);
                if (nickname) user.nickname = String(nickname);
                console.info('[FRY 60fps] Mention UID resolved:', {
                  HANDLE: user.handle,
                  UID: user.uid,
                  SEC_UID: user.secUid
                });
                return;
              }
            } catch (_) {}
          }
        } catch (_) {}
      }));
    } catch (err) {
      console.warn('[FRY 60fps] resolveMention error:', err);
    }
    resolved = true;
  }

  try { resolveMention(); } catch (_) {}

  // ================= STRING & MARKUP HELPERS =================
  function stripTags(str) {
    return String(str || '').replace(/<\/?[hm][^>]*>/g, '');
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function escapeAttr(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function cleanSignature(str, isMarkup) {
    const zeroWidthSpaces = String.fromCharCode(8203, 8204, 8205);
    const base = isMarkup ? String(str || '') : stripTags(str);
    return base
      .split(zeroWidthSpaces).join('')
      .replace(sigRegex, '')
      .replace(prefixRegex, '')
      .replace(/\n{3,}/g, '\n\n')
      .trimEnd();
  }

  function appendSignature(rawText) {
    const cleaned = cleanSignature(rawText, false);
    const fullSignature = getFullSignature();
    if (cleaned.endsWith(fullSignature)) return cleaned;
    return cleaned ? (cleaned + '\n\n' + fullSignature) : fullSignature;
  }

  function isOurMention(extra, fullText) {
    if (!extra || Number(extra.type) !== 0) return false;
    const textStr = String(fullText || '');
    const start = Number(extra.start);
    const end = Number(extra.end);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
    const slice = textStr.slice(start, end).toLowerCase();
    const uidStr = String(extra.user_id || extra.userId || '');
    const hashName = String(extra.hashtag_name || '').replace(/^@/, '').toLowerCase();
    return MENTION_USERS.some(user => {
      const mention = getMentionText(user).toLowerCase();
      const uid = String(user?.uid || '0');
      const handle = String(user?.handle || '').replace(/^@/, '').toLowerCase();
      return (
        (uid && uid !== '0' && uidStr === uid) ||
        hashName === handle ||
        slice === mention
      );
    });
  }

  function getNextTagId(extrasList) {
    const existingIds = new Set((Array.isArray(extrasList) ? extrasList : [])
      .filter(e => e && e.tag_id !== undefined && e.tag_id !== null)
      .map(e => String(e.tag_id)));
    let id = 0;
    while (existingIds.has(String(id))) id++;
    return String(id);
  }

  function buildTextExtra(existingExtras, originalText, finalPlainText) {
    const filtered = (Array.isArray(existingExtras) ? existingExtras : [])
      .filter(e => !isOurMention(e, originalText));
    const text = String(finalPlainText || '');
    const signature = getFullSignature();
    const signatureStart = text.lastIndexOf(signature);
    if (signatureStart === -1) return filtered;

    let cursor = signatureStart + PREFIX.length;
    for (const user of MENTION_USERS) {
      const mention = getMentionText(user);
      if (!mention) continue;
      const mentionIdx = text.indexOf(mention, cursor);
      if (mentionIdx === -1) continue;
      const mentionExtra = {
        start: mentionIdx,
        end: mentionIdx + mention.length,
        user_id: String(user?.uid || '0'),
        type: 0,
        hashtag_name: String(user?.handle || '').replace(/^@/, ''),
        tag_id: getNextTagId(filtered)
      };
      if (user?.secUid) mentionExtra.sec_uid = String(user.secUid);
      filtered.push(mentionExtra);
      cursor = mentionIdx + mention.length;
    }
    return filtered;
  }

  function findTagIds(textExtras, finalPlainText) {
    const text = String(finalPlainText || '');
    return MENTION_USERS.map(user => {
      const mention = getMentionText(user);
      const mentionIdx = text.lastIndexOf(mention);
      const mentionEnd = mentionIdx + mention.length;
      const found = Array.isArray(textExtras) ? textExtras.find(e =>
        e && Number(e.type) === 0 &&
        String(e.user_id || e.userId || '') === String(user?.uid || '0') &&
        Number(e.start) === mentionIdx &&
        Number(e.end) === mentionEnd
      ) : null;
      return {
        mention,
        start: mentionIdx,
        tagId: (found && found.tag_id !== undefined) ? String(found.tag_id) : '0'
      };
    });
  }

  function buildMarkupText(currentMarkup, textExtras, finalPlainText) {
    const cleaned = cleanSignature(currentMarkup, true);
    const tagInfo = findTagIds(textExtras, finalPlainText);
    const signatureMarkup = escapeHtml(PREFIX) + tagInfo.map(info =>
      '<m id="' + escapeAttr(info.tagId) + '">' + escapeHtml(info.mention) + '</m>'
    ).join(' ');
    if (!cleaned) return signatureMarkup;
    if (cleaned.indexOf(PREFIX.trim()) !== -1) return cleaned;
    return cleaned + '\n\n' + signatureMarkup;
  }

  function injectSignature(payload) {
    if (!payload || typeof payload !== 'object') return false;
    let modified = false;

    if (Array.isArray(payload.single_post_req_list)) {
      payload.single_post_req_list.forEach(req => {
        const feat = req?.single_post_feature_info;
        if (!feat || typeof feat !== 'object') return;

        const musicInfo = feat.music_info;
        const rawText = feat.text || feat.markup_text || '';
        const cleanedText = cleanSignature(rawText, false);
        const finalPlainText = appendSignature(cleanedText);

        const textExtra = buildTextExtra(
          feat.text_extra || req.text_extra,
          String(feat.text || cleanSignature(feat.markup_text || '', false)),
          finalPlainText
        );
        const markupText = buildMarkupText(
          feat.markup_text || escapeHtml(cleanedText),
          textExtra,
          finalPlainText
        );

        if (feat.text !== finalPlainText) { feat.text = finalPlainText; modified = true; }
        if (feat.markup_text !== markupText) { feat.markup_text = markupText; modified = true; }
        if (JSON.stringify(feat.text_extra || []) !== JSON.stringify(textExtra)) {
          feat.text_extra = textExtra;
          modified = true;
        }
        if (req.text_extra !== undefined) req.text_extra = textExtra;
        if (req.text !== undefined) req.text = finalPlainText;
        if (req.markup_text !== undefined) req.markup_text = markupText;

        ['caption', 'desc', 'description', 'title'].forEach(key => {
          if (typeof feat[key] === 'string' && feat[key].length) {
            const c = cleanSignature(feat[key], false);
            if (feat[key] !== c) { feat[key] = c; modified = true; }
          }
        });
        if (musicInfo) feat.music_info = musicInfo;
      });
      return modified;
    }

    const captionKeys = ['caption', 'captiontext', 'desc', 'description', 'title', 'text', 'markup_text'];
    for (const key of captionKeys) {
      if (typeof payload[key] === 'string' && payload[key].length) {
        payload[key] = appendSignature(payload[key]);
        modified = true;
      }
    }
    return modified;
  }

  function stripSignature(payload) {
    if (!payload || typeof payload !== 'object') return;
    if (Array.isArray(payload.single_post_req_list)) {
      payload.single_post_req_list.forEach(req => {
        const feat = req?.single_post_feature_info;
        if (!feat || typeof feat !== 'object') return;
        const musicInfo = feat.music_info;

        ['text', 'markup_text', 'caption', 'desc', 'description', 'title'].forEach(key => {
          if (typeof feat[key] === 'string' && feat[key]) {
            feat[key] = (key === 'markup_text') ? cleanSignature(feat[key], true) : cleanSignature(feat[key], false);
          }
          if (typeof req[key] === 'string' && req[key]) {
            req[key] = (key === 'markup_text') ? cleanSignature(req[key], true) : cleanSignature(req[key], false);
          }
        });

        const currentText = String(feat.text || '');
        if (Array.isArray(feat.text_extra)) {
          feat.text_extra = feat.text_extra.filter(e => {
            if (isOurMention(e, currentText)) return false;
            const start = Number(e.start);
            const end = Number(e.end);
            return Number.isFinite(start) && Number.isFinite(end) && start < currentText.length && end <= currentText.length;
          });
        }
        if (Array.isArray(req.text_extra)) {
          req.text_extra = req.text_extra.filter(e => {
            if (isOurMention(e, currentText)) return false;
            const start = Number(e.start);
            const end = Number(e.end);
            return Number.isFinite(start) && Number.isFinite(end) && start < currentText.length && end <= currentText.length;
          });
        }
        if (musicInfo) feat.music_info = musicInfo;
      });
    }
  }

  // ================= PAYLOAD RECOGNITION =================
  const POST_PATH = /(?:\/project\/post|\/publish\/|\/aweme\/v1\/create|\/item\/create)/i;
  const EXACT_PROJECT_POST = "tiktok/web/project/post/v1/";
  const BLOCKED = /(?:\/music\/|\/sound\/|[?&]music_id=)/i;
  const nativeStringify = JSON.stringify;

  function isPostRequest(url) {
    if (typeof url !== "string" || !/tiktok/i.test(url)) return false;
    if (url.includes(EXACT_PROJECT_POST)) return true;
    if (BLOCKED.test(url)) return false;
    return POST_PATH.test(url);
  }

  function isPostPayload(payload) {
    if (!payload || typeof payload !== "object") return false;
    return (
      Array.isArray(payload.single_post_req_list) ||
      Array.isArray(payload.item_list) ||
      Array.isArray(payload.text_extra) ||
      payload.single_post_feature_info ||
      payload.post_common_info ||
      payload.item_common_info ||
      payload.item_info ||
      payload.publish_info ||
      payload.post_info ||
      payload.enter_post
    );
  }

  function hasAdjnMusic(payload) {
    try {
      const list = Array.isArray(payload?.single_post_req_list)
        ? payload.single_post_req_list
        : [];
      return list.some(req => {
        const info = req?.single_post_feature_info;
        const music = info?.music_info;
        return !!(music?.music_id_string || music?.id);
      });
    } catch (_) {
      return false;
    }
  }

  function normalizeAdjnSound(payload) {
    if (!payload || typeof payload !== "object") return false;
    const musicPresent = hasAdjnMusic(payload);
    let changed = false;
    const remove = (obj, key) => {
      if (obj && Object.prototype.hasOwnProperty.call(obj, key)) {
        delete obj[key];
        changed = true;
      }
    };
    const setIfDifferent = (obj, key, value) => {
      if (obj && obj[key] !== value) {
        obj[key] = value;
        changed = true;
      }
    };

    ["draft", "canvas_config", "vedit_segment_info"].forEach(key => remove(payload, key));
    setIfDifferent(payload, "cloud_edit_is_use_video_canvas", false);
    setIfDifferent(payload, "psg_vsp_aud", true);
    setIfDifferent(payload, "is_high_quality", true);
    setIfDifferent(payload, "high_quality_video", 1);
    setIfDifferent(payload, "disable_auto_bitrate", true);

    if (Object.prototype.hasOwnProperty.call(payload, "enter_post_page_from")) {
      setIfDifferent(payload, "enter_post_page_from", 1);
    }

    if (payload.post_common_info && typeof payload.post_common_info === "object") {
      setIfDifferent(payload.post_common_info, "post_type", 3);
      setIfDifferent(payload.post_common_info, "enter_post_page_from", 1);
      setIfDifferent(payload.post_common_info, "psg_vsp_aud", true);
      setIfDifferent(payload.post_common_info, "is_high_quality", true);
    }

    if (musicPresent && Array.isArray(payload.feature_common_info_list)) {
      for (const item of payload.feature_common_info_list) {
        const vedit = item?.vedit_common_info;
        if (!vedit || typeof vedit !== "object") continue;
        remove(vedit, "tiktok_snap_shot_lite_params");
        if (Object.prototype.hasOwnProperty.call(vedit, "application")) {
          setIfDifferent(vedit, "application", 1);
        }
      }
    }

    if (Array.isArray(payload.single_post_req_list)) {
      for (const req of payload.single_post_req_list) {
        if (!req || typeof req !== "object") continue;
        setIfDifferent(req, "psg_vsp_aud", true);
        const info = req.single_post_feature_info;
        if (!info || typeof info !== "object") continue;

        remove(info, "vedit_segment_info");
        setIfDifferent(info, "cloud_edit_is_use_video_canvas", false);
        setIfDifferent(info, "has_original_audio", 1);
        setIfDifferent(info, "psg_vsp_aud", true);
        setIfDifferent(info, "video_quality_score", 1.0);
        setIfDifferent(info, "is_high_quality", true);
        setIfDifferent(info, "is_high_quality_video", 1);
        setIfDifferent(info, "upload_high_quality", true);
        setIfDifferent(info, "disable_auto_bitrate", true);
        setIfDifferent(info, "video_fps", 144);
        setIfDifferent(info, "source_fps", 144);

        if (info.music_info && typeof info.music_info === "object") {
          if (!info.music_info.music_id_string && info.music_info.id) {
            info.music_info.music_id_string = String(info.music_info.id);
            changed = true;
          }
        }
      }
    }
    return changed;
  }

  // Snapshot and restore cover/thumbnail/poster fields around normalization & watermark.
  function patchPayload(payload) {
    if (!isPostPayload(payload)) return false;
    const mediaSnapshot = [];
    const snapshot = (node, seen = new WeakSet()) => {
      if (!node || typeof node !== "object" || seen.has(node)) return;
      seen.add(node);
      if (Array.isArray(node)) {
        node.forEach(item => snapshot(item, seen));
        return;
      }
      for (const key of Object.keys(node)) {
        const value = node[key];
        if (/(?:^|_)(?:cover|thumbnail|poster)(?:_|$)/i.test(key)) {
          let copy = value;
          try { copy = JSON.parse(nativeStringify(value)); } catch (_) {}
          mediaSnapshot.push({ owner: node, key, value: copy });
          continue;
        }
        if (value && typeof value === "object") snapshot(value, seen);
      }
    };

    snapshot(payload);

    let changed = false;
    if (isSoundSafeActive()) {
      changed = normalizeAdjnSound(payload) || changed;
    }


    for (const item of mediaSnapshot) {
      let next = item.value;
      try { next = JSON.parse(JSON.stringify(item.value)); } catch (_) {}
      if (nativeStringify(item.owner[item.key]) !== JSON.stringify(next)) {
        item.owner[item.key] = next;
        changed = true;
      }
    }
    return changed;
  }

  function patchBody(body) {
    if (typeof body !== "string" || !body) return body;
    try {
      const parsed = JSON.parse(body);
      if (!patchPayload(parsed)) return body;
      return nativeStringify(parsed);
    } catch (_) {
      return body;
    }
  }

  JSON.stringify = function(value, replacer, space) {
    try {
      if (value && typeof value === "object") patchPayload(value);
    } catch (_) {}
    return nativeStringify.call(this, value, replacer, space);
  };

  const nativeFetch = window.fetch;
  window.fetch = async function(input, init = {}) {
    try {
      const url = typeof input === "string" ? input : input?.url || "";
      if (isPostRequest(url)) {
        try { await resolveMention(); } catch (_) {}
        if (typeof init.body === "string") {
          init = { ...init, body: patchBody(init.body) };
        } else if (typeof Request !== "undefined" && input instanceof Request) {
          const body = await input.clone().text();
          if (body) input = new Request(input, { body: patchBody(body) });
        }
      }
    } catch (_) {}
    return nativeFetch.call(this, input, init);
  };

  const xhrProto = XMLHttpRequest.prototype;
  const nativeOpen = xhrProto.open;
  const nativeSend = xhrProto.send;
  xhrProto.open = function(method, url) {
    this.__soundSafeCoverSafePostUrl = url;
    return nativeOpen.apply(this, arguments);
  };
  xhrProto.send = function(body) {
    try {
      if (isPostRequest(this.__soundSafeCoverSafePostUrl) && typeof body === "string") {
        try { resolveMention(); } catch (_) {}
        body = patchBody(body);
      }
    } catch (_) {}
    return nativeSend.call(this, body);
  };
})();
