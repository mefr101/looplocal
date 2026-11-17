#!/bin/sh
# One-time setup for a fresh Ubuntu server (Oracle Cloud's Always Free VM): Docker, a firewall that
# lets web traffic in, and some swap so a 1 GB machine can build the image.
# Run it as your normal user:  sh deploy/setup-vm.sh
set -e

echo "1/4 Installing Docker..."
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER"
fi

echo "2/4 Opening ports 80 and 443 in the server's own firewall..."
# Oracle's Ubuntu images block everything except SSH with iptables rules. Insert ours before the final REJECT.
for port in 80 443; do
  sudo iptables -C INPUT -p tcp --dport "$port" -j ACCEPT 2>/dev/null || sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport "$port" -j ACCEPT
done
sudo sh -c 'command -v netfilter-persistent >/dev/null 2>&1 || (DEBIAN_FRONTEND=noninteractive apt-get install -y iptables-persistent >/dev/null)'
sudo netfilter-persistent save

echo "3/4 Adding 2 GB of swap (if there is none)..."
if [ "$(swapon --show | wc -l)" -eq 0 ]; then
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile >/dev/null
  sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

echo "4/4 Done. Log out and back in once so Docker works without sudo, then follow deploy/ORACLE.md from step 6."
