// THE STORAGE HELPER'S PROGRAM: one fixed POSIX shell script the allocator runs, as `sh -c <this> orbit-helper <op>
// <arguments...>`, in its privileged storage helper (the image of target `storage-helper`, network none). Its
// privileges are the allocator's -- never an employee container's. It is the only code that sees the whole workforce
// volume, so it never reads or follows what an employee wrote: every path is relative to /pool, made of plain segments
// (the allocator built it from checked ids), and refused when any existing part of it is a link. Arguments are
// positional parameters, never text pasted into the script.
//
//   pool-attach <image> <MiB> <preallocate 0|1> <btrfs|xfs|ext4> <preferred /dev/loopN|->   (store at /store)
//   pool-detach <image> | pool-delete <image>
//   init <mechanism>                                     the pool's own setup (btrfs quotas on)
//   area <mechanism> <path> <bytes> <uid> <gid> <mode>   an area with its quota (0: none), made or re-applied
//   dir <path> <uid> <gid> <mode>                        a plain directory
//   usage <mechanism> <path>                             "<used bytes> <limit bytes>" (limit 0: none)
//   freeze <mechanism> <path> | remove <mechanism> <path> | rmdir <path>
//   put <path> (stdin) | get <path> | plant <path> <nonce> | unplant <path>
//   employees | df | fstype
//   subdirs <path>                                       the names of the directories in it (none followed through a link)
export const HELPER_SH = `
set -eu
umask 022
op="$1"
shift
die() { printf '%s\\n' "$*" >&2; exit 1; }
num() { case "$1" in ""|*[!0-9]*) die "not a number: $1";; esac; printf '%s' "$1"; }
rel() {
  case "$1" in ""|/*|*/|*//*) die "unsafe path: $1";; esac
  case "/$1/" in */./*|*/../*) die "unsafe path: $1";; esac
  case "$1" in *[!A-Za-z0-9_./-]*) die "unsafe path: $1";; esac
  printf '/pool/%s' "$1"
}
nolinks() {
  q=/pool
  rest=$(printf '%s' "$1" | cut -c7-)
  oldifs=$IFS
  IFS=/
  set -f
  for s in $rest; do
    q="$q/$s"
    if [ -L "$q" ]; then IFS=$oldifs; die "a link in the path: $q"; fi
  done
  set +f
  IFS=$oldifs
}
mode_ok() { case "$1" in [0-7][0-7][0-7][0-7]) ;; *) die "bad mode: $1";; esac; }
subvol_id() { btrfs subvolume show "$1" 2>/dev/null | awk '/Subvolume ID:/ { print $3; exit }'; }
project_of() {
  f="$1.orbit-project"
  if [ -f "$f" ]; then cat "$f"; return; fi
  mkdir -p /pool/.orbit
  n=$(cat /pool/.orbit/next-project 2>/dev/null || echo 1000)
  echo $((n + 1)) > /pool/.orbit/next-project
  echo "$n" > "$f"
  echo "$n"
}
image_path() {
  case "$1" in ""|.*|*[!A-Za-z0-9_.-]*) die "bad image name: $1";; esac
  printf '/store/%s' "$1"
}

case "$op" in
ping)
  echo ok ;;

pool-attach)
  img=$(image_path "$1"); size=$(num "$2"); fs="$4"; pref="$5"
  created=0; formatted=0
  if [ ! -e "$img" ]; then
    rm -f "$img.new"
    if [ "$3" = 1 ]; then
      fallocate -l "$((size * 1048576))" "$img.new" || { rm -f "$img.new"; die "could not preallocate $size MiB for the pool image (fallocate)"; }
    else
      truncate -s "$((size * 1048576))" "$img.new"
    fi
    mv "$img.new" "$img"
    created=1
  fi
  # Preallocated means every block is the image's (an earlier discard may have punched holes): allocated again, its data
  # kept, so the pool can never grow on the host's disk.
  if [ "$3" = 1 ]; then fallocate -l "$(stat -c %s "$img")" "$img" || die "could not preallocate the pool image (fallocate)"; fi
  dev=$(losetup -j "$img" -n -O NAME 2>/dev/null | head -n 1)
  if [ -z "$dev" ] && [ "$pref" != "-" ]; then
    case "$pref" in /dev/loop[0-9]*) ;; *) die "bad device: $pref";; esac
    n=$(printf '%s' "$pref" | cut -c10-)
    [ -e "$pref" ] || mknod "$pref" b 7 "$n"
    if ! losetup "$pref" >/dev/null 2>&1; then
      if losetup "$pref" "$img" 2>/dev/null; then dev="$pref"; fi
    fi
  fi
  tries=0
  while [ -z "$dev" ] && [ "$tries" -lt 5 ]; do
    d=$(losetup -f)
    n=$(printf '%s' "$d" | cut -c10-)
    [ -e "$d" ] || mknod "$d" b 7 "$n"
    if losetup "$d" "$img" 2>/dev/null; then dev="$d"; fi
    tries=$((tries + 1))
  done
  [ -n "$dev" ] || die "no free loop device could be attached to the pool image"
  have=$(blkid -p -o value -s TYPE "$dev" 2>/dev/null || true)
  if [ -z "$have" ]; then
    case "$fs" in
      btrfs) mkfs.btrfs -q -f -K -L orbit-pool "$dev" >/dev/null ;;
      xfs) mkfs.xfs -q -f -K -L orbit-pool "$dev" >/dev/null ;;
      ext4) mkfs.ext4 -q -F -E nodiscard -L orbit-area "$dev" >/dev/null ;;
      *) die "unknown filesystem: $fs" ;;
    esac
    formatted=1
  elif [ "$have" != "$fs" ]; then
    die "the pool image holds a $have filesystem, not $fs"
  fi
  bytes=$(stat -c %s "$img")
  blocks=$(stat -c %b "$img")
  printf 'dev=%s created=%s formatted=%s bytes=%s allocated=%s\\n' "$dev" "$created" "$formatted" "$bytes" "$((blocks * 512))" ;;

pool-detach|pool-delete)
  img=$(image_path "$1")
  for d in $(losetup -j "$img" -n -O NAME 2>/dev/null); do losetup -d "$d" 2>/dev/null || true; done
  if [ "$op" = pool-delete ]; then rm -f -- "$img" "$img.new"; fi
  echo ok ;;

init)
  mkdir -p /pool/accounts /pool/.orbit
  chmod 0755 /pool /pool/accounts
  chmod 0700 /pool/.orbit
  case "$1" in btrfs-qgroup) btrfs quota enable /pool ;; esac
  echo ok ;;

area)
  m="$1"; p=$(rel "$2"); b=$(num "$3"); u=$(num "$4"); g=$(num "$5"); mode_ok "$6"
  nolinks "$p"
  mkdir -p "$(dirname "$p")"
  case "$m" in
    btrfs-qgroup)
      [ -e "$p" ] || btrfs subvolume create "$p" >/dev/null
      [ -n "$(subvol_id "$p")" ] || die "$2 exists and is not a subvolume"
      if [ "$b" -gt 0 ]; then btrfs qgroup limit "$b" "$p"; else btrfs qgroup limit none "$p"; fi ;;
    xfs-loop-pool|xfs-project)
      mkdir -p "$p"
      id=$(project_of "$p")
      xfs_quota -x -c "project -s -p $p $id" /pool >/dev/null
      xfs_quota -x -c "limit -p bhard=$b $id" /pool ;;
    measured)
      mkdir -p "$p" ;;
    *) die "unknown mechanism: $m" ;;
  esac
  chown -h "$u:$g" "$p"
  chmod "$6" "$p"
  echo ok ;;

dir)
  p=$(rel "$1"); u=$(num "$2"); g=$(num "$3"); mode_ok "$4"
  nolinks "$p"
  mkdir -p "$p"
  chown -h "$u:$g" "$p"
  chmod "$4" "$p"
  echo ok ;;

usage)
  m="$1"; p=$(rel "$2")
  nolinks "$p"
  [ -e "$p" ] || { echo missing >&2; exit 3; }
  case "$m" in
    btrfs-qgroup)
      btrfs filesystem sync /pool >/dev/null 2>&1 || true
      id=$(subvol_id "$p")
      [ -n "$id" ] || die "$2 is not a subvolume"
      btrfs qgroup show -re --raw /pool | awk -v q="0/$id" '$1 == q { l = $4; if (l == "none") l = 0; print $2, l; f = 1 } END { if (!f) exit 4 }' ;;
    xfs-loop-pool|xfs-project)
      id=$(project_of "$p")
      xfs_quota -x -c "report -p -b -N -L $id -U $id" /pool | awk '{ print $2 * 1024, $4 * 1024; exit }' ;;
    measured)
      printf '%s 0\\n' "$(du -s -B1 -x "$p" | cut -f1)" ;;
    *) die "unknown mechanism: $m" ;;
  esac ;;

freeze)
  m="$1"; p=$(rel "$2")
  nolinks "$p"
  [ -e "$p" ] || { echo ok; exit 0; }
  case "$m" in
    btrfs-qgroup) btrfs property set -ts "$p" ro true ;;
    *) chattr -R +i "$p" 2>/dev/null || chmod -R a-w "$p" ;;
  esac
  echo ok ;;

remove)
  m="$1"; p=$(rel "$2")
  nolinks "$p"
  [ -e "$p" ] || { echo gone; exit 0; }
  case "$m" in
    btrfs-qgroup)
      id=$(subvol_id "$p")
      btrfs property set -ts "$p" ro false 2>/dev/null || true
      for inner in $(btrfs subvolume list -o "$p" 2>/dev/null | awk '{ print $NF }' | sort -r); do
        btrfs property set -ts "/pool/$inner" ro false 2>/dev/null || true
        btrfs subvolume delete "/pool/$inner" >/dev/null 2>&1 || true
      done
      btrfs subvolume delete "$p" >/dev/null
      if [ -n "$id" ]; then btrfs qgroup destroy "0/$id" /pool >/dev/null 2>&1 || true; fi ;;
    xfs-loop-pool|xfs-project)
      id=$(project_of "$p")
      chattr -R -i "$p" 2>/dev/null || true
      rm -rf -- "$p"
      xfs_quota -x -c "limit -p bhard=0 $id" /pool >/dev/null 2>&1 || true
      rm -f -- "$p.orbit-project" ;;
    *)
      chattr -R -i "$p" 2>/dev/null || true
      chmod -R u+w "$p" 2>/dev/null || true
      rm -rf -- "$p" ;;
  esac
  [ ! -e "$p" ] || die "$2 is still there after its removal"
  echo gone ;;

rmdir)
  p=$(rel "$1")
  nolinks "$p"
  rm -rf -- "$p"
  [ ! -e "$p" ] || die "$1 is still there"
  echo gone ;;

put)
  p=$(rel "$1")
  nolinks "$p"
  mkdir -p "$(dirname "$p")"
  cat > "$p.tmp.$$"
  mv -f "$p.tmp.$$" "$p"
  echo ok ;;

get)
  p=$(rel "$1")
  nolinks "$p"
  [ -f "$p" ] || exit 3
  cat "$p" ;;

plant)
  p=$(rel "$1")
  nolinks "$p"
  [ -d "$(dirname "$p")" ] || exit 3
  [ ! -e "$p" ] || die "$1 exists"
  printf '%s' "$2" > "$p"
  chmod 0644 "$p"
  echo ok ;;

unplant)
  p=$(rel "$1")
  nolinks "$p"
  rm -f -- "$p"
  echo ok ;;

thaw-all)
  # Before the whole workforce volume is removed: what an archive froze is made removable again.
  chattr -R -i /pool 2>/dev/null || true
  chmod -R u+w /pool 2>/dev/null || true
  echo ok ;;

subdirs)
  p=$(rel "$1")
  nolinks "$p"
  [ -d "$p" ] || exit 0
  for d in "$p"/*; do
    if [ -d "$d" ] && [ ! -L "$d" ]; then basename "$d"; fi
  done
  true ;;

employees)
  for d in /pool/accounts/*/employees/*; do
    if [ -d "$d/desk" ] && [ ! -L "$d" ]; then printf '%s\\n' "$d" | cut -c7-; fi
  done
  true ;;

df)
  df -B1 --output=size,avail /pool | tail -n 1 ;;

fstype)
  stat -f -c %T /pool
  awk '$2 == "/pool" { print $4; exit }' /proc/mounts ;;

*)
  die "unknown operation: $op" ;;
esac
`;
