#!/bin/sh
# Make sure the data folder belongs to the app user, then drop root and start.
set -e
mkdir -p /data
chown -R "${MAHINA_UID}:${MAHINA_UID}" /data
exec setpriv --reuid="${MAHINA_UID}" --regid="${MAHINA_UID}" --clear-groups -- "$@"
