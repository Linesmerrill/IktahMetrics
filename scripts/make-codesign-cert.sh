#!/usr/bin/env bash
# Generate a self-signed code signing certificate for IktahMetrics releases.
#
# Run this ONCE locally. Add the printed CSC_LINK and CSC_KEY_PASSWORD as
# GitHub Actions secrets in this repo's Settings → Secrets → Actions.
#
# Why: without a stable code signing identity, every release has a
# different ad-hoc signature. macOS TCC then sees each update as a "new
# app" and asks the user to re-grant Screen Recording permission. With
# this self-signed cert, every release shares an identity, and TCC
# remembers the grant across updates.
#
# The certificate is self-signed (not from Apple) — it's not trusted by
# Gatekeeper, so the "from an unidentified developer" warning still
# appears on first install. But TCC permission grants persist, which is
# what was looping.

set -e

WORKDIR=$(mktemp -d)
trap "rm -rf '$WORKDIR'" EXIT

PASSWORD=$(openssl rand -hex 16)

cat > "$WORKDIR/cert.cnf" << 'EOF'
[req]
distinguished_name = req_dn
x509_extensions = v3_ext
prompt = no

[req_dn]
CN = IktahMetrics Self-Signed
O = IktahMetrics

[v3_ext]
keyUsage = critical, digitalSignature
extendedKeyUsage = codeSigning
EOF

openssl req -x509 -newkey rsa:2048 \
  -keyout "$WORKDIR/key.pem" \
  -out "$WORKDIR/cert.pem" \
  -days 3650 \
  -nodes \
  -config "$WORKDIR/cert.cnf" 2>/dev/null

openssl pkcs12 -export \
  -out "$WORKDIR/cert.p12" \
  -inkey "$WORKDIR/key.pem" \
  -in "$WORKDIR/cert.pem" \
  -password "pass:$PASSWORD" \
  -legacy 2>/dev/null

cat <<HEADER

==========================================================
Add the following to GitHub Secrets:
  https://github.com/Linesmerrill/IktahMetrics/settings/secrets/actions
==========================================================

HEADER

echo "Secret name:  CSC_LINK"
echo "Secret value (base64-encoded .p12, copy everything between the markers):"
echo "----- BEGIN CSC_LINK -----"
base64 < "$WORKDIR/cert.p12"
echo "----- END CSC_LINK -----"
echo
echo "Secret name:  CSC_KEY_PASSWORD"
echo "Secret value:"
echo "$PASSWORD"
echo

cat <<FOOTER
After both secrets are saved, the next push to main will sign with this
cert, and TCC will remember Screen Recording grants across releases.

(The cert never leaves your machine + GitHub. The .p12 file in $WORKDIR
will be deleted when this script exits.)
FOOTER
