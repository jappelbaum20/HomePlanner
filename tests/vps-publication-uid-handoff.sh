#!/usr/bin/env bash
# Demonstrate only the filesystem boundary with retained synthetic ciphertexts.
# This does not install, define or approve a privileged service or executable.
set -Eeuo pipefail
source=${1:?synthetic staged directory}; target=${2:?new synthetic fixture directory}
[[ $(id -u) = 0 && $source = /home/jacoba/hpstage2publication20261108i-public-user/staging/20* && $target = /home/jacoba/hpstage2publication-* && ! -e $target && -d $source && ! -L $source ]] || exit 1
[[ $(realpath -e "$source") = "$source" ]] || exit 1
mkdir -m 711 "$target"
install -d -m 700 -o 1000 -g 1000 "$target/staging" "$target/destination"
stamp=${source##*/}
runuser -u jacoba -- cp -R "$source" "$target/staging/$stamp"
[[ $(stat -c %u "$target/staging/$stamp") = 1000 ]]
python3 deployment/publish-backup.py "$target/staging/$stamp" "$target/destination"
[[ $(stat -c '%u:%a' "$target/destination/$stamp") = 1000:500 ]]
for name in database.dump.gpg photos.tar.gpg photos.sha256z.gpg SHA256SUMS; do
 [[ $(stat -c '%u:%a' "$target/destination/$stamp/$name") = 1000:400 ]]
done
runuser -u jacoba -- sh -c 'cd "$1" && sha256sum -c SHA256SUMS >/dev/null' sh "$target/destination/$stamp"
echo 'PASS synthetic root publication preserves UID 1000 ownership and read access'
