FROM python:3.11-slim as build-base

RUN apt-get update --option "Acquire::Retries=3" --quiet=2 && \
    apt-get install \
        --no-install-recommends \
        --assume-yes \
        --quiet=2 \
        # So we can use Python-slim
        build-essential gcc python3-dev\
        # So postgres can compile and users can use dbshell
        libpq-dev postgresql-client \
        # So we can use webpack to compile assets
        nodejs npm \
        # For installing poetry and git-based deps
        curl git \
        # For maintenance tasks \
        screen redis-tools \
        # Other dependencies
        libffi-dev libxml2-dev libxslt-dev procps vim cmake

# Set PGSSLCERT at a dummy location ro avoid a SSL error connection.
# https://github.com/freelawproject/courtlistener/issues/2827
ENV PGSSLCERT=/tmp/postgresql.crt

# poetry
# https://python-poetry.org/docs/configuration/#using-environment-variables
ENV POETRY_VERSION=1.6.1 \
    # make poetry install to this location
    POETRY_HOME="/opt/poetry" \
    # Don't build a virtualenv to save space
    POETRY_VIRTUALENVS_CREATE=false \
    # do not ask any interactive question
    POETRY_NO_INTERACTION=1

ENV PYTHONUNBUFFERED=1 \
    # this is where our requirements are copied to
    PYSETUP_PATH="/opt/pysetup"

RUN python -m venv $POETRY_HOME && \
    $POETRY_HOME/bin/pip install poetry==$POETRY_VERSION --quiet --upgrade && \
    ln -s $POETRY_HOME/bin/poetry "$(dirname $(which python))/poetry"  # make accessible via $PATH

ARG BUILD_ENV=prod
FROM build-base as python-base

WORKDIR $PYSETUP_PATH

COPY poetry.lock pyproject.toml ./
RUN poetry install --no-root $(test "$BUILD_ENV" != "dev" && echo "--without dev")

COPY . /opt/courtlistener


# Collect compiled assets from webpack-build stage.
# Note: Always produce production code and never produce source-maps
# (run the devMiddleware for legible output)
WORKDIR /opt/courtlistener/cl
RUN npm install
RUN npx webpack --mode=production --no-devtool

WORKDIR /opt

# We log to stdout by default, but we have a config for logging here. Even if
# we don't use this logger, we need to have the file or else Python is unhappy.
RUN mkdir /var/log/courtlistener \
  && chown -R www-data:www-data /var/log/courtlistener \
  && mkdir /var/log/juriscraper \
  && chown -R www-data:www-data /var/log/juriscraper/ \
  && mkdir -p /opt/courtlistener/cl/assets/static/

WORKDIR /opt/courtlistener

# freelawproject/courtlistener:latest-celery
FROM python-base as celery

## Needs to be two commands so second one can use variables from first.
ENV PYTHONPATH="${PYTHONPATH}:/opt/courtlistener"

USER www-data
CMD celery \
    --app=cl worker \
    --loglevel=info \
    --events \
    --pool=prefork \
    --hostname=prefork@%h \
    --queues=${CELERY_QUEUES} \
    --concurrency=${CELERY_PREFORK_CONCURRENCY:-0} \
    --prefetch-multiplier=${CELERY_PREFETCH_MULTIPLIER:-1}

FROM python-base as web-dev

USER www-data
CMD python /opt/courtlistener/manage.py migrate && \
    python /opt/courtlistener/manage.py createcachetable && \
    python /opt/courtlistener/manage.py runserver 0.0.0.0:8000

#freelawproject/courtlistener:latest-web-prod
FROM python-base as web-prod

USER www-data
CMD gunicorn cl.asgi:application \
    --chdir /opt/courtlistener/ \
    --user www-data \
    --group www-data \
    # Set high number of workers. Docs recommend 2-4× core count`
    --workers ${NUM_WORKERS:-48} \
    --worker-class cl.workers.UvicornWorker \
    # Allow longer queries to solr.
    --limit-request-line 6000 \
    # Reset each worker once in a while
    --max-requests 10000 \
    --max-requests-jitter 100 \
    --timeout 180 \
    --bind 0.0.0.0:8000

#freelawproject/courtlistener:latest-scrape-rss
FROM python-base as rss-scraper

USER www-data
CMD /opt/courtlistener/manage.py scrape_rss


FROM python-base as retry-webhooks

USER www-data
CMD /opt/courtlistener/manage.py cl_retry_webhooks
