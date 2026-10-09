FROM python:3.12-slim

# libfribidi нужна для арабской вязи на карточках
RUN apt-get update \
    && apt-get install -y --no-install-recommends libfribidi0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .

ENV DATA_DIR=/data PYTHONUNBUFFERED=1
VOLUME ["/data"]
CMD ["python", "bot.py"]
