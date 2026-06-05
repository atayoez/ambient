#!/usr/bin/env bash
# scripts/sign-rpms.sh — GPG-sign one or more .rpm files. Designed to run
# INSIDE a fedora container (which ships rpm + dnf), so the host needs no
# rpm tooling — this keeps it portable across the self-hosted Arch runner
# (no native rpm; conflicts with rpmextract) and GitHub's Ubuntu runners.
# ci-publish.sh invokes it via:
#   docker run --rm -v "$OUT":/out -v "$PWD/scripts":/scripts:ro \
#     -e RPM_GPG_PRIVATE_KEY -e RPM_GPG_PASSPHRASE \
#     fedora:latest bash /scripts/sign-rpms.sh /out/foo.rpm /out/bar.rpm
#
# Env:
#   RPM_GPG_PRIVATE_KEY  — base64 of the ASCII-armored secret key
#   RPM_GPG_PASSPHRASE   — the key's passphrase
# Args: the .rpm paths to sign (in place).
set -euo pipefail

if [[ -z "${RPM_GPG_PRIVATE_KEY:-}" ]]; then
  echo "sign-rpms: RPM_GPG_PRIVATE_KEY is empty" >&2
  exit 1
fi
if [[ $# -eq 0 ]]; then
  echo "sign-rpms: no rpm paths given" >&2
  exit 1
fi

# rpm-sign provides `rpmsign`/`--addsign`; gnupg2 provides gpg. Both absent
# from the minimal fedora image. Quiet unless it fails.
if ! command -v rpmsign >/dev/null 2>&1 || ! command -v gpg >/dev/null 2>&1; then
  if command -v dnf >/dev/null 2>&1; then
    dnf install -y -q rpm-sign gnupg2 >/dev/null
  elif command -v microdnf >/dev/null 2>&1; then
    microdnf install -y rpm-sign gnupg2 >/dev/null
  else
    echo "sign-rpms: no dnf/microdnf to install rpm-sign + gnupg2" >&2
    exit 1
  fi
fi

export GNUPGHOME
GNUPGHOME="$(mktemp -d)"
chmod 700 "$GNUPGHOME"
echo "allow-loopback-pinentry" > "$GNUPGHOME/gpg-agent.conf"

printf '%s' "$RPM_GPG_PRIVATE_KEY" | base64 -d | gpg --batch --quiet --import
FPR="$(gpg --list-keys --with-colons | awk -F: '/^fpr/{print $10; exit}')"

PASS_FILE="$(mktemp)"
printf '%s' "${RPM_GPG_PASSPHRASE:-}" > "$PASS_FILE"

# rpm shells out to this to produce the detached header signature.
cat > "$HOME/.rpmmacros" <<EOF
%_signature gpg
%_gpg_name $FPR
%__gpg_sign_cmd %{__gpg} --batch --no-verbose --no-armor --pinentry-mode loopback --passphrase-file $PASS_FILE --no-secmem-warning -u "%{_gpg_name}" --digest-algo sha256 -sbo %{__signature_filename} %{__plaintext_filename}
EOF

rpmsign --addsign "$@"

# Hard-fail if any rpm didn't actually pick up a signature.
for r in "$@"; do
  sig="$(rpm -qp --qf '%{RSAHEADER:pgpsig}|%{SIGPGP:pgpsig}' "$r" 2>/dev/null || true)"
  if echo "$sig" | grep -qi 'key id'; then
    echo "signed: $(basename "$r")"
  else
    echo "ERROR: $(basename "$r") is unsigned after rpmsign --addsign" >&2
    exit 1
  fi
done

rm -f "$PASS_FILE"
rm -rf "$GNUPGHOME"
