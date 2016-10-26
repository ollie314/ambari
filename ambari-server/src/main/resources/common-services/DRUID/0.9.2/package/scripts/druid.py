"""
Licensed to the Apache Software Foundation (ASF) under one
or more contributor license agreements.  See the NOTICE file
distributed with this work for additional information
regarding copyright ownership.  The ASF licenses this file
to you under the Apache License, Version 2.0 (the
"License"); you may not use this file except in compliance
with the License.  You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

"""
from resource_management.libraries.resources.properties_file import PropertiesFile
from resource_management.core.resources.system import Directory, Execute, File
from resource_management.core.source import InlineTemplate
from resource_management.libraries.functions import format
from resource_management.libraries.resources import XmlConfig
from resource_management.libraries.functions.show_logs import show_logs
from resource_management.core.logger import Logger


def druid(upgrade_type=None, nodeType=None):
  import params
  ensure_base_directories()

  # Environment Variables
  File(format("{params.druid_conf_dir}/druid-env.sh"),
       owner=params.druid_user,
       content=InlineTemplate(params.druid_env_sh_template)
       )

  # common config
  druid_common_config = mutable_config_dict(params.config['configurations']['druid-common'])
  # User cannot override below configs
  druid_common_config['druid.host'] = params.hostname
  druid_common_config['druid.extensions.directory'] = params.druid_extensions_dir
  druid_common_config['druid.extensions.hadoopDependenciesDir'] = params.druid_hadoop_dependencies_dir
  druid_common_config['druid.selectors.indexing.serviceName'] = params.config['configurations']['druid-overlord'][
    'druid.service']
  druid_common_config['druid.selectors.coordinator.serviceName'] = \
    params.config['configurations']['druid-coordinator']['druid.service']

  # delete the password and user if empty otherwiswe derby will fail.
  if 'derby' == druid_common_config['druid.metadata.storage.type']:
    del druid_common_config['druid.metadata.storage.connector.user']
    del druid_common_config['druid.metadata.storage.connector.password']

  druid_env_config = mutable_config_dict(params.config['configurations']['druid-env'])

  PropertiesFile("common.runtime.properties",
                 dir=params.druid_common_conf_dir,
                 properties=druid_common_config,
                 owner=params.druid_user,
                 group=params.user_group,
                 )
  Logger.info("Created common.runtime.properties")

  File(format("{params.druid_common_conf_dir}/druid-log4j.xml"),
       mode=0644,
       owner=params.druid_user,
       group=params.user_group,
       content=InlineTemplate(params.log4j_props)
       )
  Logger.info("Created log4j file")

  File("/etc/logrotate.d/druid",
       mode=0644,
       owner='root',
       group='root',
       content=InlineTemplate(params.logrotate_props)
       )

  Logger.info("Created log rotate file")

  # Write Hadoop Configs if configured
  if 'core-site' in params.config['configurations']:
    XmlConfig("core-site.xml",
              conf_dir=params.druid_common_conf_dir,
              configurations=params.config['configurations']['core-site'],
              configuration_attributes=params.config['configuration_attributes']['core-site'],
              owner=params.druid_user,
              group=params.user_group
              )

  if 'mapred-site' in params.config['configurations']:
    XmlConfig("mapred-site.xml",
              conf_dir=params.druid_common_conf_dir,
              configurations=params.config['configurations']['mapred-site'],
              configuration_attributes=params.config['configuration_attributes']['mapred-site'],
              owner=params.druid_user,
              group=params.user_group
              )

  if 'yarn-site' in params.config['configurations']:
    XmlConfig("yarn-site.xml",
              conf_dir=params.druid_common_conf_dir,
              configurations=params.config['configurations']['yarn-site'],
              configuration_attributes=params.config['configuration_attributes']['yarn-site'],
              owner=params.druid_user,
              group=params.user_group
              )

  if 'hdfs-site' in params.config['configurations']:
    XmlConfig("hdfs-site.xml",
              conf_dir=params.druid_common_conf_dir,
              configurations=params.config['configurations']['hdfs-site'],
              configuration_attributes=params.config['configuration_attributes']['hdfs-site'],
              owner=params.druid_user,
              group=params.user_group
              )

  # node specific configs
  for node_type in ['coordinator', 'overlord', 'historical', 'broker', 'middleManager', 'router']:
    node_config_dir = format('{params.druid_conf_dir}/{node_type}')
    node_type_lowercase = node_type.lower()

    # Write runtime.properties file
    node_config = mutable_config_dict(params.config['configurations'][format('druid-{node_type_lowercase}')])
    PropertiesFile("runtime.properties",
                   dir=node_config_dir,
                   properties=node_config,
                   owner=params.druid_user,
                   group=params.user_group,
                   )
    Logger.info(format("Created druid-{node_type_lowercase} runtime.properties"))

    # Write jvm configs
    File(format('{node_config_dir}/jvm.config'),
         owner=params.druid_user,
         group=params.user_group,
         content=InlineTemplate(
           "-server \n-Xms{{node_heap_memory}}m \n-Xmx{{node_heap_memory}}m \n-XX:MaxDirectMemorySize={{node_direct_memory}}m \n-Dlog4j.configurationFile={{log4j_config_file}} \n-Dlog4j.debug \n{{node_jvm_opts}}",
           node_heap_memory=druid_env_config[format('druid.{node_type_lowercase}.jvm.heap.memory')],
           log4j_config_file=format("{params.druid_common_conf_dir}/druid-log4j.xml"),
           node_direct_memory=druid_env_config[
             format('druid.{node_type_lowercase}.jvm.direct.memory')],
           node_jvm_opts=druid_env_config[format('druid.{node_type_lowercase}.jvm.opts')])
         )
    Logger.info(format("Created druid-{node_type_lowercase} jvm.config"))

  # All druid nodes have dependency on hdfs_client
  ensure_hadoop_directories()
  # Pull all required dependencies
  pulldeps()


def mutable_config_dict(config):
  rv = {}
  for key, value in config.iteritems():
    rv[key] = value
  return rv


def ensure_hadoop_directories():
  import params
  if 'hdfs-site' not in params.config['configurations']:
    # HDFS Not Installed nothing to do.
    Logger.info("Skipping HDFS directory creation as HDFS not installed")
    return

  druid_common_config = params.config['configurations']['druid-common']
  # final overlord config contains both common and overlord config
  druid_middlemanager_config = params.config['configurations']['druid-middlemanager']

  # If user is using HDFS as deep storage create HDFS Directory for storing segments
  deep_storage = druid_common_config["druid.storage.type"]
  storage_dir = druid_common_config["druid.storage.storageDirectory"]

  if deep_storage == 'hdfs':
    # create the home dir for druid
    params.HdfsResource(format("/user/{params.druid_user}"),
                        type="directory",
                        action="create_on_execute",
                        owner=params.druid_user,
                        recursive_chown=True,
                        recursive_chmod=True
                        )

    # create the segment storage dir
    create_hadoop_directory(storage_dir)

  # Create HadoopIndexTask hadoopWorkingPath
  hadoop_working_path = druid_middlemanager_config['druid.indexer.task.hadoopWorkingPath']
  if hadoop_working_path is not None:
    create_hadoop_directory(hadoop_working_path)

  # If HDFS is used for storing logs, create Index Task log directory
  indexer_logs_type = druid_common_config['druid.indexer.logs.type']
  indexer_logs_directory = druid_common_config['druid.indexer.logs.directory']
  if indexer_logs_type == 'hdfs' and indexer_logs_directory is not None:
    create_hadoop_directory(indexer_logs_directory)


def create_hadoop_directory(hadoop_dir):
  import params
  params.HdfsResource(hadoop_dir,
                      type="directory",
                      action="create_on_execute",
                      owner=params.druid_user,
                      mode=0755
                      )
  Logger.info(format("Created Hadoop Directory [{hadoop_dir}]"))


def ensure_base_directories():
  import params
  Directory(
    [params.druid_log_dir, params.druid_pid_dir, params.druid_common_conf_dir, params.druid_coordinator_conf_dir,
     params.druid_broker_conf_dir, params.druid_middlemanager_conf_dir, params.druid_historical_conf_dir,
     params.druid_overlord_conf_dir, params.druid_router_conf_dir, params.druid_segment_infoDir],
    mode=0755,
    cd_access='a',
    owner=params.druid_user,
    group=params.user_group,
    create_parents=True,
    recursive_ownership=True,
  )


def get_daemon_cmd(params=None, node_type=None, command=None):
  return format('source {params.druid_conf_dir}/druid-env.sh ; {params.druid_home}/bin/node.sh {node_type} {command}')


def getPid(params=None, nodeType=None):
  return format('{params.druid_pid_dir}/{nodeType}.pid')


def pulldeps():
  import params
  extensions_list = eval(params.druid_extensions)
  extensions_string = '{0}'.format("-c ".join(extensions_list))
  if len(extensions_list) > 0:
    try:
      # Make sure druid user has permissions to write dependencies
      Directory(
        [params.druid_extensions_dir, params.druid_hadoop_dependencies_dir],
        mode=0755,
        cd_access='a',
        owner=params.druid_user,
        group=params.user_group,
        create_parents=True,
        recursive_ownership=True,
      )
      Execute(format(
        "source {params.druid_conf_dir}/druid-env.sh ; java -classpath '{params.druid_home}/lib/*' -Ddruid.extensions.loadList=[] "
        "-Ddruid.extensions.directory={params.druid_extensions_dir} -Ddruid.extensions.hadoopDependenciesDir={params.druid_hadoop_dependencies_dir} "
        "io.druid.cli.Main tools pull-deps -c {extensions_string} --no-default-hadoop"),
        user=params.druid_user
      )
      Logger.info(format("Pull Dependencies Complete"))
    except:
      show_logs(params.druid_log_dir, params.druid_user)
      raise
