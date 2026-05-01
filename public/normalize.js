(function attachNormalizer(root) {
  'use strict';

  const TAKEOUT_WORDS = ['takeout', 'hand', 'remove', 'retrieving', 'pull'];
  const THROW_WORDS = ['throw', 'dart'];

  function asText(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (typeof value === 'object') {
      if (typeof value.name === 'string') return value.name;
      if (typeof value.segment === 'string') return value.segment;
      if (typeof value.field === 'string') return value.field;
    }
    return '';
  }

  function asFiniteNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function parseSegmentScore(segmentName) {
    const text = asText(segmentName).trim();
    if (!text) return 0;

    const normalized = text.replace(/\s+/g, '').toLowerCase();
    if (['miss', 'outside', 'out', 'nohit', 'none', 'null'].includes(normalized)) return 0;
    if (['bull', 'dbull', 'doublebull', 'innerbull', 'bullseye', 'd25'].includes(normalized)) return 50;
    if (['outerbull', 'singlebull', 's25', '25'].includes(normalized)) return 25;

    const match = normalized.match(/^([sdt])?(\d{1,2})$/);
    if (!match) return 0;

    const number = Number(match[2]);
    if (!Number.isFinite(number)) return 0;
    if (number === 25) return match[1] === 'd' ? 50 : 25;
    if (number < 1 || number > 20) return 0;

    const multiplier = match[1] === 'd' ? 2 : match[1] === 't' ? 3 : 1;
    return number * multiplier;
  }

  function getSegmentName(throwItem) {
    if (!throwItem || typeof throwItem !== 'object') return 'Unknown';

    const candidates = [
      throwItem.segment && throwItem.segment.name,
      throwItem.segment,
      throwItem.name,
      throwItem.field,
      throwItem.bed,
      throwItem.score
    ];

    const base = candidates.map(asText).find(Boolean);
    if (!base) return 'Unknown';

    const multiplier = asFiniteNumber(
      throwItem.multiplier !== undefined ? throwItem.multiplier : throwItem.segment && throwItem.segment.multiplier
    );
    const number = asFiniteNumber(
      throwItem.number !== undefined ? throwItem.number : throwItem.segment && throwItem.segment.number
    );

    if (/^(single|double|triple)$/i.test(base) && number !== null) {
      return `${base[0].toUpperCase()}${number}`;
    }

    if (/^single/i.test(base) && number !== null) return `S${number}`;
    if (/^double/i.test(base) && number !== null) return `D${number}`;
    if (/^triple|^treble/i.test(base) && number !== null) return `T${number}`;
    if (/^\d+$/.test(base) && multiplier !== null && multiplier > 1) {
      return `${multiplier === 2 ? 'D' : multiplier === 3 ? 'T' : 'S'}${base}`;
    }

    return base;
  }

  function getCoordinates(throwItem) {
    if (!throwItem || typeof throwItem !== 'object') return { x: null, y: null };
    const x = asFiniteNumber(throwItem.coords && throwItem.coords.x);
    const y = asFiniteNumber(throwItem.coords && throwItem.coords.y);
    return {
      x: x !== null ? x : asFiniteNumber(throwItem.x),
      y: y !== null ? y : asFiniteNumber(throwItem.y)
    };
  }

  function getThrowsArray(raw) {
    if (!raw || typeof raw !== 'object') return [];
    if (Array.isArray(raw.throws)) return raw.throws;
    if (Array.isArray(raw.darts)) return raw.darts;
    if (Array.isArray(raw.visit)) return raw.visit;
    if (Array.isArray(raw.data && raw.data.throws)) return raw.data.throws;
    return [];
  }

  function includesAny(text, words) {
    const value = asText(text).toLowerCase();
    return words.some((word) => value.includes(word));
  }

  function normalizeAutodartsState(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const statusText = asText(source.status);
    const eventText = asText(source.event);
    const combinedText = `${statusText} ${eventText}`.toLowerCase();
    const connected = Boolean(source.connected);
    const running = Boolean(source.running);

    const rawThrows = getThrowsArray(source);
    const throws = rawThrows.map((item, index) => {
      const segmentName = getSegmentName(item);
      const coords = getCoordinates(item);
      return {
        index: index + 1,
        segmentName,
        score: parseSegmentScore(segmentName),
        x: coords.x,
        y: coords.y,
        raw: item && typeof item === 'object' ? item : { value: item }
      };
    });

    const numericNumThrows = asFiniteNumber(source.numThrows);
    const numThrows = throws.length > 0 ? throws.length : Math.max(0, numericNumThrows || 0);
    const takeoutMentioned = includesAny(combinedText, TAKEOUT_WORDS);
    const takeoutFinished = takeoutMentioned && includesAny(combinedText, ['finished', 'ended', 'complete', 'completed', 'done']);
    const takeoutActive = takeoutMentioned && !takeoutFinished;
    const handDetected = takeoutActive || (includesAny(combinedText, ['hand']) && !takeoutFinished);
    const throwDetected = includesAny(combinedText, THROW_WORDS);
    const hasError = includesAny(combinedText, ['error', 'failed', 'timeout']);

    let phase = 'unknown';
    if (!connected || !running) {
      phase = 'offline';
    } else if (hasError) {
      phase = 'error';
    } else if (takeoutActive) {
      phase = 'takeout';
    } else if (throwDetected && numThrows > 0) {
      phase = 'dart-detected';
    } else if (throwDetected) {
      phase = 'throwing';
    } else if (statusText || eventText) {
      phase = 'idle';
    }

    return {
      connected,
      running,
      statusText,
      eventText,
      phase,
      takeoutActive,
      handDetected,
      numThrows,
      throws,
      visitScore: throws.reduce((sum, dart) => sum + dart.score, 0),
      raw: source
    };
  }

  function isAllowedPrivateHost(host) {
    const value = asText(host).trim().toLowerCase();
    if (!value) return false;
    if (value === 'localhost') return true;
    if (value === '127.0.0.1' || value === '::1') return true;

    const ipMatch = value.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (!ipMatch) return false;
    const parts = ipMatch.slice(1).map(Number);
    if (parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;

    const [a, b] = parts;
    if (a === 10) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    return false;
  }

  const api = {
    normalizeAutodartsState,
    parseSegmentScore,
    isAllowedPrivateHost
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.AutodartsNormalizer = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
