/*
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 * 
 * http://www.apache.org/licenses/LICENSE-2.0
 * 
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */
package org.apache.ambari.logsearch.model.request;

import io.swagger.annotations.ApiParam;
import org.apache.ambari.logsearch.common.LogSearchConstants;

import static org.apache.ambari.logsearch.doc.DocConstants.ServiceDescriptions.LEVEL_D;
import static org.apache.ambari.logsearch.doc.DocConstants.ServiceDescriptions.HOST_NAME_D;
import static org.apache.ambari.logsearch.doc.DocConstants.ServiceDescriptions.COMPONENT_NAME_D;
import static org.apache.ambari.logsearch.doc.DocConstants.ServiceDescriptions.FILE_NAME_D;

public interface ServiceLogParamDefinition {

  String getLevel();

  @ApiParam(value = LEVEL_D, name = LogSearchConstants.REQUEST_PARAM_LEVEL)
  void setLevel(String level);

  String getHostName();

  @ApiParam(value = HOST_NAME_D, name = LogSearchConstants.REQUEST_PARAM_HOST_NAME)
  void setHostName(String hostName);

  String getComponentName();

  @ApiParam(value = COMPONENT_NAME_D, name = LogSearchConstants.REQUEST_PARAM_COMPONENT_NAME)
  void setComponentName(String componentName);

  String getFileName();

  @ApiParam(value = FILE_NAME_D, name = LogSearchConstants.REQUEST_PARAM_FILE_NAME)
  void setFileName(String fileName);
}
