# Alibaba Cloud ECS Deploy

This deployment runs TRIANGLE Invoice OS on one Alibaba Cloud ECS instance with Docker Compose.

## Recommended ECS

- Ubuntu 24.04 LTS
- 2 vCPU / 4 GB RAM minimum
- 4 vCPU / 8 GB RAM recommended when OCR usage grows
- Open inbound ports: `22`, `80`, `443`

## First Setup On ECS

```bash
sudo apt update
sudo apt install -y ca-certificates curl git
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker "$USER"
```

Log out and back in after adding the Docker group, or run the remaining commands with `sudo docker`.

## Deploy

```bash
git clone https://github.com/xxx83482904-glitch/triangle-invoice-os.git
cd triangle-invoice-os/deploy/alibaba
cp .env.example .env
nano .env
docker compose up -d --build
```

When using a domain, set:

```env
APP_DOMAIN="invoice.example.com"
APP_URL="https://invoice.example.com"
```

Caddy will issue and renew HTTPS certificates automatically when DNS points to the ECS public IP and ports `80` and `443` are open.

## Update

```bash
cd triangle-invoice-os
git pull
cd deploy/alibaba
docker compose up -d --build
```

## Backup

Back up the PostgreSQL volume or dump the database:

```bash
docker exec triangle-invoice-os-db pg_dump -U triangle triangle_invoice_os > triangle_invoice_os_$(date +%F).sql
```

Files are stored in PostgreSQL when `FILE_STORAGE_DRIVER=database`, so the database dump includes app data and uploaded documents.
