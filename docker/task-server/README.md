The files in this directory are used to run the CourtListener asynchronous task
server and associated services. These are the components:

 - Our code that creates work. This is done using the Celery framework. When 
   you have work to do, you run something like `my_function.delay()`. This
   creates a task that is added to...
 
 - ...a "queue" of work to be done. This is a queue that's held in Redis. It is 
   just a list of tasks that need to get processed, including various 
   information about those tasks, like their priority, their processing status, 
   etc. This Redis instance can be run in docker — or not. The task sits on 
   this queue until...  
 
 - ...a "worker" comes along. Workers are independent Celery daemons that watch
   the queue and process tasks as they're created. Workers are run inside a the
   docker image in this directory. 
   
Due to the complexity of workers, they need access to the full CourtListener 
code, the PostgreSQL database, the file system (for processing PDFs), and Redis
(for monitoring the queue as well as using it as a cache/db). As you can 
imagine, giving a docker image access to all these things is...difficult. But
doable! 

We provide two ways to run this image, a DockerFile and a docker-compose file. 
Each is described below.


## How settings work

Connecting to everything is done through a combination of command line flags 
given to `docker run` command and settings stored in the `cl/settings` 
directory. The files in this directory contain all of the settings for 
CourtListener. They are read by the Celery worker in alphabetical order, with
each subsequent file potentially overriding the previous one.

Thus, `10-public.py` contains default settings for CourtListener and Celery. To 
override it, simply create a file in `cl/settings` called `11-public.py`. In 
that file you can create any connection settings that you need and they'll 
override the settings in `10-public.py`, because of the higher number in the 
file name. 

You can find an example file to use for `11-private.py` in this directory.

Files that are read later (with higher numbered file names) have access to the 
context of files that are read earlier. For example, if `01-some-name.py` 
contains:
 
    SOME_VAR = {'some-key': 'some-value'}
    
You could create a file called `02-my-overrides.py` that contained:

    SOME_VAR['some-key'] = 'some-other-value'
    
That is, you can assume that `SOME_VAR` exists because it was declared in an 
earlier settings file. Your IDE will likely complain that `SOME_VAR` doesn't 
exist in `02-my-overrides.py`, but ignore your IDE. If you want to read the 
code behind all this, look in `settings.py`.


## DockerFile purpose and usage

The DockerFile exists to keep things simple. You can use this as a developer, 
to test things, or to avoid running all the other bits and pieces needed by the
full docker-compose file. When you launch the image associated with this 
DockerFile, you will run one Celery worker. This is *fine* for development, but 
if you want more than one, you should use the compose file, which will can 
launch as many as hundreds of workers at a time.

To run the image described in the DockerFile, run something like:

    docker run -d \ 
        --volume /path/to/courtlistener:/opt/celery:ro \
        --volume /var/run/postgresql/:/var/run/postgresql \
        --volume /path/to/my/storage/area/:/sata \
        --log-driver journald \
        --name task-server \
        --network cl_net_overlay \
        freelawproject/task-server:latest

That establishes the following:

1. The CourtListener code base is available at `/opt/celery` inside the docker 
   image.

1. A unix socket is shared between the docker container and your local system 
   for access to Postgresql. This is optional. If you prefer to connect to 
   Postgresql via a network connection omit this line. (The connection itself 
   is configured in your settings files — read on.) If you do plan to use this,
   ensure that you have the unix socket configured to allow connections in 
   Postgresql.

1. For (not great) historical reasons, CourtListener expects to find things in
   `/sata`. You could probably change this in the settings, but the easier 
   thing to do is map a directory on your local system to /sata, and that 
   should just work.

1. Use `--network` if you want. We use it to put our docker images into an 
   overlay network.

1. The rest should make sense.

For settings, as described above, you'll want to create a file called  
`cl/settings/11-private.py`. In the file, you'll need to configure the 
connection to:

 - Redis - Look for the `REDIS_HOST` variable.
 
 - Postgresql - Look for the `DATABASES` variable (details of how to set this
   are in the Django docs).

For example, our production settings are something like:

    REDIS_HOST = '256.64.24.1'
    DATABASES['default']['HOST'] = ''
    
This just sets the IP of the Redis host (it's remote), and sets the host of the
DB to use the unix socket (it's on the machine hosting docker).


## Using the docker-compose.yaml file

Running things this way lets you run innumerable Celery workers. It also 
launches good things like `flower`, which helps with Celery monitoring, for 
example.

To get this going start by initing the swarm if you haven't already:

    docker swarm init
    
Then set up the network:

    docker network create -d overlay --attachable cl_net_overlay
        
With that done, you'll run something like:
    
    sudo \
    CELERY_PREFORK_CONCURRENCY=10 \
    CELERY_GEVENT_CONCURRENCY=512 \
    CL_CODE_DIR=/home/username/projects/courtlistener \
    DJANGO_MEDIA_ROOT=/sata \
    POSTGRESQL_SOCK=/var/run/postgresql \
    docker stack deploy --compose-file docker-compose.yml task-server

Some explanation of variables:

 - `CELERY_PREFORK_CONCURRENCY` — The compose file starts two workers. One with
   workers running in prefork mode. This sets how many tasks to run 
   concurrently in prefork mode and sets a docker CPU limit of that number of 
   CPUs.
   
 - `CELERY_GEVENT_CONCURRENCY` — Same, but for the `gevent` worker that we 
   start (which is optimized for IO-bound tasks).
   
 - `CELERY_GEVENT_CPU_LIMIT` — An optional variable for setting the number of 
   CPUs available to the gevent worker. Default is 20 CPUs.
   
 - `CL_CODE_DIR` — Where the image can find the CourtListener code. 
 
 - `DJANGO_MEDIA_ROOT` — Where you want to store your local media files, like 
   PDFs, MP3s, etc. This is important in prod because it allows you to use a 
   different drive for this than the one where everything else resides.
 
 - `POSTGRESQL_SOCK` — An optional setting for using the unix socket to connect
   to PostgreSQL. By default this is set to `/dev/null`, but you might want to
   set it to `/var/run/postgresql`.


## Running jobs

Running jobs can be done by placing them into one of two queues:

 - io_bound — for IO bound tasks like networking ones, where a gevent pool will 
   help. When using `docker run` this will just use prefork otherwise, it uses
   gevent.
 
 - celery — the default queue, which uses a prefork multiprocessing pool to do 
   the work. If you don't specify a queue, you'll wind up here.

To run a job, then, do something like:

    my_job.apply_async(args=(2, 3), queue='io_bound')
   
Or to go to `celery`, the default queue, do:

    my_job.delay(2, 3)


## Setting up the filesystem

Docker seems to make this difficult, permissions-wise. If you look in the 
Dockerfile, you'll see that we run celery in a group with ID of `3502`. The 
number is arbitrary — it was just the number the server assigned when we 
created the group.

So the trick, now that we know that celery is being run by a user in this 
group, is to set up the filesystem to expect that user. We do this using the 
same basic instructions we use for the Solr indexes (though it's a bigger pain
in this case b/c there are so many more files):

    # Put the files in the right group and make it sticky
    chown -R :3502 /data/myvolume
    find /data/myvolume -type d -exec chmod g+s {} \;

Change the permissions of the directory to allow the celery group the access it 
needs to directories and files respectively:
   
    find /data/myvolume -type d -exec chmod 775 {} \;
    find /data/myvolume -type f -exec chmod 664 {} \;
    
[This approach adapted from the link here](https://medium.com/@nielssj/docker-volumes-and-file-system-permissions-772c1aee23ca). 