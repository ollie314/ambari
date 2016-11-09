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
package org.apache.ambari.logsearch;

import java.io.IOException;
import java.net.MalformedURLException;
import java.net.ServerSocket;
import java.net.URI;
import java.net.URISyntaxException;
import java.net.URL;
import java.util.EnumSet;

import org.apache.ambari.logsearch.common.ManageStartEndTime;
import org.apache.ambari.logsearch.common.PropertiesHelper;
import org.apache.ambari.logsearch.conf.ApplicationConfig;
import org.apache.ambari.logsearch.util.SSLUtil;
import org.apache.commons.lang.StringUtils;
import org.apache.log4j.Logger;
import org.eclipse.jetty.server.Connector;
import org.eclipse.jetty.server.HttpConfiguration;
import org.eclipse.jetty.server.HttpConnectionFactory;
import org.eclipse.jetty.server.SecureRequestCustomizer;
import org.eclipse.jetty.server.Server;
import org.eclipse.jetty.server.ServerConnector;
import org.eclipse.jetty.server.SslConnectionFactory;
import org.eclipse.jetty.server.handler.HandlerList;
import org.eclipse.jetty.server.handler.ResourceHandler;
import org.eclipse.jetty.servlet.FilterHolder;
import org.eclipse.jetty.servlet.ServletContextHandler;
import org.eclipse.jetty.servlet.ServletHolder;
import org.eclipse.jetty.util.resource.Resource;
import org.eclipse.jetty.util.ssl.SslContextFactory;
import org.eclipse.jetty.webapp.WebAppContext;
import org.springframework.web.context.ContextLoaderListener;
import org.springframework.web.context.request.RequestContextListener;
import org.springframework.web.context.support.AnnotationConfigWebApplicationContext;
import org.springframework.web.filter.DelegatingFilterProxy;

import javax.servlet.DispatcherType;

public class LogSearch {
  private static final Logger logger = Logger.getLogger(LogSearch.class);

  private static final String LOGSEARCH_PROTOCOL_PROP = "logsearch.protocol";
  private static final String HTTPS_PROTOCOL = "https";
  private static final String HTTP_PROTOCOL = "http";
  private static final String HTTPS_PORT = "61889";
  private static final String HTTP_PORT = "61888";
  
  private static final String WEB_RESOURCE_FOLDER = "webapps/app";
  private static final String ROOT_CONTEXT = "/";
  private static final Integer SESSION_TIMEOUT = 30;

 
  public static void main(String[] argv) {
    LogSearch logSearch = new LogSearch();
    ManageStartEndTime.manage();
    try {
      logSearch.run(argv);
    } catch (Throwable e) {
      logger.error("Error running logsearch server", e);
    }
  }
  
  public void run(String[] argv) throws Exception {
    Server server = buildSever(argv);
    HandlerList handlers = new HandlerList();
    handlers.addHandler(createSwaggerContext());
    handlers.addHandler(createBaseWebappContext());

    server.setHandler(handlers);
    server.start();

    logger
        .debug("============================Server Dump=======================================");
    logger.debug(server.dump());
    logger
        .debug("==============================================================================");
    server.join();
  }

  public Server buildSever(String argv[]) {
    Server server = new Server();
    ServerConnector connector = new ServerConnector(server);
    boolean portSpecified = argv.length > 0;
    String protcolProperty = PropertiesHelper.getProperty(LOGSEARCH_PROTOCOL_PROP,HTTP_PROTOCOL);
    if (StringUtils.isEmpty(protcolProperty)) {
      protcolProperty = HTTP_PROTOCOL;
    }
    String port = null;
    if (HTTPS_PROTOCOL.equals(protcolProperty) && SSLUtil.isKeyStoreSpecified()) {
      logger.info("Building https server...........");
      port = portSpecified ? argv[0] : HTTPS_PORT;
      checkPort(Integer.parseInt(port));
      HttpConfiguration https = new HttpConfiguration();
      https.addCustomizer(new SecureRequestCustomizer());
      SslContextFactory sslContextFactory = SSLUtil.getSslContextFactory();
      ServerConnector sslConnector = new ServerConnector(server,
          new SslConnectionFactory(sslContextFactory, "http/1.1"),
          new HttpConnectionFactory(https));
      sslConnector.setPort(Integer.parseInt(port));
      server.setConnectors(new Connector[] { sslConnector });
    } else {
      logger.info("Building http server...........");
      port = portSpecified ? argv[0] : HTTP_PORT;
      checkPort(Integer.parseInt(port));
      connector.setPort(Integer.parseInt(port));
      server.setConnectors(new Connector[] { connector });
    }
    URI logsearchURI = URI.create(String.format("%s://0.0.0.0:%s", protcolProperty, port));
    logger.info("Starting logsearch server URI=" + logsearchURI);
    return server;
  }

  private WebAppContext createBaseWebappContext() throws MalformedURLException {
    URI webResourceBase = findWebResourceBase();
    WebAppContext context = new WebAppContext();
    context.setBaseResource(Resource.newResource(webResourceBase));
    context.setContextPath(ROOT_CONTEXT);
    context.setParentLoaderPriority(true);

    // Configure Spring
    context.addEventListener(new ContextLoaderListener());
    context.addEventListener(new RequestContextListener());
    context.addFilter(new FilterHolder(new DelegatingFilterProxy("springSecurityFilterChain")), "/*", EnumSet.allOf(DispatcherType.class));
    context.setInitParameter("contextClass", AnnotationConfigWebApplicationContext.class.getName());
    context.setInitParameter("contextConfigLocation", ApplicationConfig.class.getName());

    // Configure Jersey
    ServletHolder jerseyServlet = context.addServlet(org.glassfish.jersey.servlet.ServletContainer.class, "/api/v1/*");
    jerseyServlet.setInitOrder(1);
    jerseyServlet.setInitParameter("jersey.config.server.provider.packages","org.apache.ambari.logsearch.rest,io.swagger.jaxrs.listing");

    context.getSessionHandler().getSessionManager().setMaxInactiveInterval(SESSION_TIMEOUT);

    return context;
  }

  private ServletContextHandler createSwaggerContext() throws URISyntaxException {
    ResourceHandler resourceHandler = new ResourceHandler();
    resourceHandler.setResourceBase(LogSearch.class.getClassLoader()
      .getResource("META-INF/resources/webjars/swagger-ui/2.1.0")
      .toURI().toString());
    ServletContextHandler context = new ServletContextHandler();
    context.setContextPath("/docs/");
    context.setHandler(resourceHandler);
    return context;
  }

  private URI findWebResourceBase() {
    URL fileCompleteUrl = Thread.currentThread().getContextClassLoader()
        .getResource(WEB_RESOURCE_FOLDER);
    String errorMessage = "Web Resource Folder " + WEB_RESOURCE_FOLDER+ " not found in classpath";
    if (fileCompleteUrl != null) {
      try {
        return fileCompleteUrl.toURI().normalize();
      } catch (URISyntaxException e) {
        logger.error(errorMessage, e);
        System.exit(1);
      }
    } else {
      logger.error(errorMessage);
      System.exit(1);
    }
    throw new IllegalStateException(errorMessage);
  }

  private void checkPort(int port) {
    ServerSocket serverSocket = null;
    boolean portBusy = false;
    try {
      serverSocket = new ServerSocket(port);
    } catch (IOException ex) {
      portBusy = true;
      logger.error(ex.getLocalizedMessage() + " PORT :" + port);
    } finally {
      if (serverSocket != null) {
        try {
          serverSocket.close();
        } catch (Exception exception) {
          // ignore
        }
      }
      if (portBusy) {
        System.exit(1);
      }
    }
  }

}
