# Kingsley Hills SL-05b — Property Manager

A full-stack property management app for tracking the purchase, renovation, inventory, and shared notes for Kingsley Hills SL-05b.

---

## Features

| Module | Description |
|---|---|
| **Action Plan** | 39 pre-loaded tasks across 5 phases (Pre-Offer → SPA → Move-In) with status tracking |
| **Inventory & Costing** | Procurement tracker with categories, quantities, pricing, and budget vs. actuals |
| **Renovation Works** | Work items by area/floor, assigned tradesman, estimated vs. actual costs |
| **Scratchpad** | Shared timestamped notes between you and your contractor |

---

## EC2 Deployment (step by step)

### 1. Launch EC2 instance
- AMI: **Amazon Linux 2023** (free tier eligible)
- Instance type: **t3.micro** (sufficient for 2 users)
- Security group: allow **TCP port 80** from your IP(s), and **SSH port 22** from your IP

### 2. SSH into your instance
```bash
ssh -i your-key.pem ec2-user@YOUR_EC2_PUBLIC_IP
```

### 3. Install Docker & Docker Compose
```bash
sudo dnf update -y
sudo dnf install -y docker
sudo systemctl enable --now docker
sudo usermod -aG docker ec2-user

# Log out and back in for group change to take effect, then:
docker --version

# Install Docker Compose plugin
sudo mkdir -p /usr/local/lib/docker/cli-plugins
sudo curl -SL https://github.com/docker/compose/releases/latest/download/docker-compose-linux-x86_64 \
  -o /usr/local/lib/docker/cli-plugins/docker-compose
sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
docker compose version
```

### 4. Upload the app to EC2
From your local machine, upload the app folder:
```bash
scp -i your-key.pem -r kingsley-app/ ec2-user@YOUR_EC2_PUBLIC_IP:~/
```

### 5. Create your .env file on EC2
```bash
cd ~/kingsley-app
cp .env.example .env
nano .env   # Set APP_PIN to something memorable but not obvious
```

### 6. Build and start the app
```bash
docker compose up -d --build
```

### 7. Access the app
Open in your browser: `http://YOUR_EC2_PUBLIC_IP`

Share this URL + the PIN with your contractor. That's it.

---

## Data backup

Your SQLite database lives in `~/kingsley-app/data/app.db`. Back it up regularly:
```bash
# Copy to your local machine
scp -i your-key.pem ec2-user@YOUR_EC2_PUBLIC_IP:~/kingsley-app/data/app.db ./backup-$(date +%Y%m%d).db
```

---

## Updating the app

```bash
cd ~/kingsley-app
# Upload new files via scp, then:
docker compose up -d --build
```

---

## Useful commands

```bash
docker compose logs -f        # View live logs
docker compose restart        # Restart the app
docker compose down           # Stop the app
docker compose up -d          # Start the app
```

---

## Cost estimate (AWS)

| Resource | Type | Est. Monthly Cost |
|---|---|---|
| EC2 t3.micro | Compute | ~$8–10 (or free tier year 1) |
| EBS 8GB | Storage | ~$0.80 |
| Data transfer | Network | < $1 |
| **Total** | | **~$9–12/month** |
