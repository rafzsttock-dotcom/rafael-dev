FROM python:3.12-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends gcc && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY main.py .
ENV TELEGRAM_SERVICE_HOST=0.0.0.0 TELEGRAM_SERVICE_PORT=8090
EXPOSE 8090
CMD ["python", "-u", "main.py"]
