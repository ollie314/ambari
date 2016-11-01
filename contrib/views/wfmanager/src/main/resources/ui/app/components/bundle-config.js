/*
*    Licensed to the Apache Software Foundation (ASF) under one or more
*    contributor license agreements.  See the NOTICE file distributed with
*    this work for additional information regarding copyright ownership.
*    The ASF licenses this file to You under the Apache License, Version 2.0
*    (the "License"); you may not use this file except in compliance with
*    the License.  You may obtain a copy of the License at
*
*        http://www.apache.org/licenses/LICENSE-2.0
*
*    Unless required by applicable law or agreed to in writing, software
*    distributed under the License is distributed on an "AS IS" BASIS,
*    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
*    See the License for the specific language governing permissions and
*    limitations under the License.
*/
import Ember from 'ember';
import {Bundle} from '../domain/bundle/bundle';
import {BundleGenerator} from '../domain/bundle/bundle-xml-generator';
import {BundleXmlImporter} from '../domain/bundle/bundle-xml-importer';
import { validator, buildValidations } from 'ember-cp-validations';
import Constants from '../utils/constants';

const Validations = buildValidations({
  'bundle.name': validator('presence', {
    presence : true
  }),
  'bundle.coordinators': {
    validators: [
      validator('operand-length', {
        min : 1,
        dependentKeys: ['bundle','bundle.coordinators.[]'],
        message : 'Alteast one coordinator is required',
        disabled(model, attribute) {
          return !model.get('bundle');
        }
      })
    ]
  }
});

export default Ember.Component.extend(Ember.Evented, Validations, {
  bundle : null,
  propertyExtractor : Ember.inject.service('property-extractor'),
  fileBrowser : Ember.inject.service('file-browser'),
  workspaceManager : Ember.inject.service('workspace-manager'),
  initialize : function(){
    var draftBundle = this.get('workspaceManager').restoreWorkInProgress(this.get('tabInfo.id'));
    if(draftBundle){
      this.set('bundle', JSON.parse(draftBundle));
    }else{
      this.set('bundle', this.createBundle());
    }
    this.get('fileBrowser').on('fileBrowserOpened',function(context){
      this.get('fileBrowser').setContext(context);
    }.bind(this));
    this.on('fileSelected',function(fileName){
      this.set(this.get('filePathModel'), fileName);
    }.bind(this));
    if(Ember.isBlank(this.get('bundle.name'))){
      this.set('bundle.name', Ember.copy(this.get('tabInfo.name')));
    }
    this.set('showErrorMessage', false);
    this.schedulePersistWorkInProgress();
  }.on('init'),
  onDestroy : function(){
    Ember.run.cancel(this.schedulePersistWorkInProgress);
    this.persistWorkInProgress();
  }.on('willDestroyElement'),
  observeFilePath : Ember.observer('bundleFilePath', function(){
    if(!this.get('bundleFilePath') || null === this.get('bundleFilePath')){
      return;
    }else{
      this.sendAction('changeFilePath', this.get('tabInfo'), this.get('bundleFilePath'));
    }
  }),
  nameObserver : Ember.observer('bundle.name', function(){
    if(!this.get('bundle')){
      return;
    }else if(this.get('bundle') && Ember.isBlank(this.get('bundle.name'))){
      if(!this.get('clonedTabInfo')){
        this.set('clonedTabInfo', Ember.copy(this.get('tabInfo')));
      }
      this.sendAction('changeTabName', this.get('tabInfo'), this.get('clonedTabInfo.name'));
    }else{
      this.sendAction('changeTabName', this.get('tabInfo'), this.get('bundle.name'));
    }
  }),
  schedulePersistWorkInProgress (){
    Ember.run.later(function(){
      this.persistWorkInProgress();
      this.schedulePersistWorkInProgress();
    }.bind(this), Constants.persistWorkInProgressInterval);
  },
  persistWorkInProgress (){
    if(!this.get('bundle')){
      return;
    }
    var json = JSON.stringify(this.get("bundle"));
    this.get('workspaceManager').saveWorkInProgress(this.get('tabInfo.id'), json);
  },
  createBundle (){
    return Bundle.create({
      name : '',
      kickOffTime : {
        value : '',
        displayValue : '',
        type : 'date'
      },
      coordinators : null
    });
  },
  importSampleBundle (){
    var deferred = Ember.RSVP.defer();
    Ember.$.ajax({
      url: "/sampledata/bundle.xml",
      dataType: "text",
      cache:false,
      success: function(data) {
        deferred.resolve(data);
      }.bind(this),
      failure : function(data){
        deferred.reject(data);
      }
    });
    return deferred;
  },
  importBundle (filePath){
    this.set("bundleFilePath", filePath);
    this.set("isImporting", false);
    var deferred = this.getBundleFromHdfs(filePath);
    deferred.promise.then(function(data){
      this.getBundleFromXml(data);
      this.set("isImporting", false);
    }.bind(this)).catch(function(){
      this.set("isImporting", false);
      this.set("isImportingSuccess", false);
    }.bind(this));
  },
  getBundleFromHdfs(filePath){
    var url =  Ember.ENV.API_URL + "/readWorkflowXml?workflowXmlPath="+filePath;
    var deferred = Ember.RSVP.defer();
    Ember.$.ajax({
      url: url,
      method: 'GET',
      dataType: "text",
      beforeSend: function (xhr) {
        xhr.setRequestHeader("X-XSRF-HEADER", Math.round(Math.random()*100000));
        xhr.setRequestHeader("X-Requested-By", "Ambari");
      }
    }).done(function(data){
      deferred.resolve(data);
    }).fail(function(){
      deferred.reject();
    });
    return deferred;
  },
  getBundleFromXml(bundleXml){
    var bundleXmlImporter = BundleXmlImporter.create({});
    var bundle = bundleXmlImporter.importBundle(bundleXml);
    this.set("bundle", bundle);
  },
  actions : {
    closeFileBrowser(){
      this.set("showingFileBrowser", false);
      this.get('fileBrowser').getContext().trigger('fileSelected', this.get('filePath'));
      if(this.get('bundleFilePath')){
        this.importBundle(Ember.copy(this.get('bundleFilePath')));
        this.set('bundleFilePath', null);
      }
    },
    openFileBrowser(model, context){
      if(!context){
        context = this;
      }
      this.get('fileBrowser').trigger('fileBrowserOpened',context);
      this.set('filePathModel', model);
      this.set('showingFileBrowser', true);
    },
    createCoordinator(){
      this.set('coordinatorEditMode', false);
      this.set('coordinatorCreateMode', true);
      this.set('currentCoordinator',{
        name : undefined,
        appPath : undefined,
        configuration : {
          property : Ember.A([])
        }
      });
    },
    editCoordinator(index){
      this.set('coordinatorEditMode', true);
      this.set('coordinatorCreateMode', false);
      this.set('currentCoordinatorIndex', index);
      this.set('currentCoordinator', Ember.copy(this.get('bundle.coordinators').objectAt(index)));
    },
    addCoordinator(){
      if(!this.get('bundle.coordinators')){
        this.set('bundle.coordinators', Ember.A([]));
      }
      this.get('bundle.coordinators').pushObject(Ember.copy(this.get('currentCoordinator')));
      this.set('coordinatorCreateMode', false);
    },
    updateCoordinator(){
      this.get('bundle.coordinators').replace(this.get('currentCoordinatorIndex'), 1, Ember.copy(this.get('currentCoordinator')));
      this.set('coordinatorEditMode', false);
    },
    deleteCoordinator(index){
      this.get('bundle.coordinators').removeAt(index);
      if(index === this.get('currentCoordinatorIndex')){
        this.set('coordinatorEditMode', false);
      }
    },
    cancelCoordinatorOperation(){
      this.set('coordinatorCreateMode', false);
      this.set('coordinatorEditMode', false);
    },
    confirmReset(){
      this.set('showingResetConfirmation', true);
    },
    resetBundle(){
      this.set('bundle', this.createBundle());
    },
    closeBundleSubmitConfig(){
      this.set("showingJobConfig", false);
    },
    submitBundle(){
      if(this.get('validations.isInvalid')) {
        this.set('showErrorMessage', true);
        return;
      }
      var bundleGenerator = BundleGenerator.create({bundle:this.get("bundle")});
      var bundleXml = bundleGenerator.process();
      var dynamicProperties = this.get('propertyExtractor').getDynamicProperties(bundleXml);
      var configForSubmit = {props : dynamicProperties, xml : bundleXml, params : this.get('bundle.parameters')};
      this.set("bundleConfigs", configForSubmit);
      this.set("showingJobConfig", true);
    },
    preview(){
      if(this.get('validations.isInvalid')) {
        this.set('showErrorMessage', true);
        return;
      }
      this.set("showingPreview", false);
      var bundleGenerator = BundleGenerator.create({bundle:this.get("bundle")});
      var bundleXml = bundleGenerator.process();
      this.set("previewXml", vkbeautify.xml(bundleXml));
      this.set("showingPreview", true);
    },
    importBundleTest(){
      var deferred = this.importSampleBundle();
      deferred.promise.then(function(data){
        this.getBundleFromXml(data);
      }.bind(this)).catch(function(e){
        throw new Error(e);
      });
    },
    openTab(type, path){
      this.sendAction('openTab', type, path);
    }
  }
});
