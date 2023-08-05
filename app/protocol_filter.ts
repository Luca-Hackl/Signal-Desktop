// Copyright 2018 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import type { Session } from 'electron';

import { isAbsolute, normalize } from 'path';
import { existsSync, realpathSync } from 'fs';
import {
  getAvatarsPath,
  getBadgesPath,
  getDraftPath,
  getPath,
  getStickersPath,
  getTempPath,
  getUpdateCachePath,
} from './attachments';
function _eliminateAllAfterCharacter(
  string: string,
  character: string
): string {
  const index = string.indexOf(character);
  if (index < 0) {
    return string;
  }

  return string.slice(0, index);
}

export function _urlToPath(
  targetUrl: string,
  options?: { isWindows: boolean }
): string {
  const decoded = decodeURIComponent(targetUrl);

  // We generally expect URLs to start with file:// or file:/// here, but for users with
  //   their home directory redirected to a UNC share, it will start with //.
  const withoutScheme = decoded.startsWith('//')
    ? decoded
    : decoded.slice(options?.isWindows ? 8 : 7);

  const withoutQuerystring = _eliminateAllAfterCharacter(withoutScheme, '?');
  const withoutHash = _eliminateAllAfterCharacter(withoutQuerystring, '#');

  return withoutHash;
}

function _createFileHandler({
  userDataPath,
  installPath,
  isWindows,
}: {
  userDataPath: string;
  installPath: string;
  isWindows: boolean;
}) {
  const allowedRoots = [
    userDataPath,
    installPath,
    getAvatarsPath(userDataPath),
    getBadgesPath(userDataPath),
    getDraftPath(userDataPath),
    getPath(userDataPath),
    getStickersPath(userDataPath),
    getTempPath(userDataPath),
    getUpdateCachePath(userDataPath),
  ];
  return (request: Request): Response => {
    let targetPath;

    if (!request.url) {
      // This is an "invalid URL" error. See [Chromium's net error list][0].
      //
      // [0]: https://source.chromium.org/chromium/chromium/src/+/master:net/base/net_error_list.h;l=563;drc=a836ee9868cf1b9673fce362a82c98aba3e195de
      return new Response(null,{status : -300})
    }

    try {
      targetPath = _urlToPath(request.url, { isWindows });

      // normalize() is primarily useful here for switching / to \ on windows
      const target = normalize(targetPath);
      // here we attempt to follow symlinks to the ultimate final path, reflective of what
      //   we do in main.js on userDataPath and installPath
      const realPath = existsSync(target) ? realpathSync(target) : target;
      // finally we do case-insensitive checks on windows
      const properCasing = isWindows ? realPath.toLowerCase() : realPath;

      if (!isAbsolute(realPath)) {
        console.log(
          `Warning: denying request to non-absolute path '${realPath}'`
        );
        // This is an "Access Denied" error. See [Chromium's net error list][0].
        //
        // [0]: https://source.chromium.org/chromium/chromium/src/+/master:net/base/net_error_list.h;l=57;drc=a836ee9868cf1b9673fce362a82c98aba3e195de
        return new Response(null,{status : -10})
      }

      for (const root of allowedRoots) {
        if (properCasing.startsWith(isWindows ? root.toLowerCase() : root)) {
          return new Response(JSON.stringify({ path: realPath }));
        }
      }

      console.log(
        `Warning: denying request to path '${realPath}' (allowedRoots: '${allowedRoots}')`
      );
      return new Response(null,{status : -10})
    } catch (err) {
      const errorMessage =
        err && typeof err.message === 'string'
          ? err.message
          : 'no error message';
      console.log(
        `Warning: denying request because of an error: ${errorMessage}`
      );

      return new Response(null,{status : -10})
    }
  };
}

export function installFileHandler({
  session,
  userDataPath,
  installPath,
  isWindows,
}: {
  session: Session;
  userDataPath: string;
  installPath: string;
  isWindows: boolean;
}): void {
  session.protocol.handle('file', _createFileHandler({ userDataPath, installPath, isWindows }));
}

// Turn off browser URI scheme since we do all network requests via Node.js
function _disabledHandler(
    _request: Request,
): Response {
  //callback({ error: -10 }); //Old
  return new Response(null,{status : -10})
}

export function installWebHandler({
                                    session,
                                    enableHttp,
                                  }: {
  session: Session;
  enableHttp: boolean;
}): void {
  const { protocol } = session;
  protocol.handle('about', _disabledHandler);
  protocol.handle('content', _disabledHandler);
  protocol.handle('chrome', _disabledHandler);
  protocol.handle('cid', _disabledHandler);
  protocol.handle('data', _disabledHandler);
  protocol.handle('filesystem', _disabledHandler);
  protocol.handle('ftp', _disabledHandler);
  protocol.handle('gopher', _disabledHandler);
  protocol.handle('javascript', _disabledHandler);
  protocol.handle('mailto', _disabledHandler);

  if (!enableHttp) {
    protocol.handle('http', _disabledHandler);
    protocol.handle('https', _disabledHandler);
    protocol.handle('ws', _disabledHandler);
    protocol.handle('wss', _disabledHandler);
  }
}
