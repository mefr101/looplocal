#!/bin/sh
# One-time setup for a fresh Ubuntu server (Oracle Cloud or Google Cloud free VM): Docker, a firewall
# that lets web traffic in (only where the image blocks it), and some swap so a 1 GB machine can build.
# Run it as your normal user:  sh deploy/setup-vm.sh
set -e

echo "1/4 Installing Docker..."
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER"
fi

echo "2/4 Opening ports 80 and 443 in the server's own firewall (if it blocks them)..."
# Oracle's Ubuntu images block everything except SSH with an iptables REJECT rule. Insert ours just before it.
# Google Cloud's images have no such rule (their firewall is outside the VM), so there is nothing to do.
reject_line=$(sudo iptables -L INPUT --line-numbers -n 2>/dev/null | awk '$2 == "REJECT" { print $1; exit }')
if [ -n "$reject_line" ]; then
  for port in 80 443; do
    sudo iptables -C INPUT -p tcp --dport "$port" -j ACCEPT 2>/dev/null || sudo iptables -I INPUT "$reject_line" -m state --state NEW -p tcp --dport "$port" -j ACCEPT
  done
  sudo sh -c 'command -v netfilter-persistent >/dev/null 2>&1 || (DEBIAN_FRONTEND=noninteractive apt-get install -y iptables-persistent >/dev/null)'
  sudo netfilter-persistent save
else
  echo "    No blocking rule found; skipping."
fi

echo "3/4 Adding 2 GB of swap (if there is none)..."
if [ "$(swapon --show | wc -l)" -eq 0 ]; then
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile >/dev/null
  sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

echo "4/4 Done. Log out and back in once so Docker works without sudo, then continue with the guide (the Configure step)."
