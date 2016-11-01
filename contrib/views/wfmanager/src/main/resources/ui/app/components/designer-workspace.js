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

export default Ember.Component.extend({
  workspaceManager : Ember.inject.service('workspace-manager'),
  xmlAppPath : null,
  appPath : null,
  type : 'wf',
  tabId: 0,
  hasMultitabSupport : true,
  tabCounter : new Map(),
  tabs : Ember.A([]),
  currentIndex : Ember.computed('tabs.[]', function() {
    return this.get('tabs').length > 0 ? this.get('tabs').length - 1 : 0;
  }),
  tabsObserver : Ember.observer('tabs.[]', function(){
    this.get('workspaceManager').saveTabs(this.get('tabs'));
  }),
  initialize : function(){
    this.get('tabCounter').set('wf', 0);
    this.get('tabCounter').set('coord', 0);
    this.get('tabCounter').set('bundle', 0);
    var tabs = this.get('workspaceManager').restoreTabs();
    if(tabs){
      this.set('tabs', tabs);
    }
    this.get('tabs').forEach((tab)=>{
      this.get('tabCounter').set(tab.type, (this.get('tabCounter').get(tab.type)) + 1);
    }, this);
  }.on('init'),
  elementsInserted : function(){
    this.$('.nav-tabs a[data-toggle="tab"]').on('shown.bs.tab', function (e) {
      this.get('workspaceManager').setLastActiveTab((this.$(e.target).attr('href').slice(1)));
    }.bind(this));

    if(this.get('tabs') && this.get('tabs').length > 0){
      var lastActiveTabId = this.get('workspaceManager').getLastActiveTab();
      var activeTab = this.get('tabs').findBy('id', lastActiveTabId);
      if(!activeTab){
        activeTab = this.get('tabs').objectAt(this.get('tabs').length - 1);
      }
      this.$('.nav-tabs a[href="#' + activeTab.id + '"]').tab('show');
    }else{
      if(this.get('hasMultitabSupport')){
        this.createNewTab(this.get('type'), this.get('xmlAppPath'));
      }else{
         var tab = this.get('tabs').findBy('type', this.get('type'));
        if(!tab){
          this.createNewTab(this.get('type'), this.get('xmlAppPath'));
        }else{
          Ember.set(tab,'path', this.get('xmlAppPath'));
          this.$('.nav-tabs a[href="#' + tab.id + '"]').tab('show');
        }
      }
    }
  }.on('didInsertElement'),
  onDestroy : function(){
    this.get('tabs').clear();
  }.on('willDestroyElement'),
  createNewTab : function(type, path){
    var tab = {
      type : type,
      id : this.generateTabId(),
      name : this.getDisplayName(type)+this.getTabId(type)
    };
    if(path){
      tab.path = path;
    }
    this.$('.nav-tabs li').removeClass('active');
    this.$('.tab-content .tab-pane').removeClass('active');
    this.get('tabs').pushObject(tab);
    this.set('isNew', true);
  },
  getDisplayName(type){
    if(type === 'wf'){
      return "Workflow";
    }else if(type === 'coord'){
      return "Coordinator";
    }else{
      return "Bundle";
    }
  },
  getTabId(type){
    var count = this.get('tabCounter').get(type);
    this.get('tabCounter').set(type, ++count);
    return count;
  },
  generateTabId(){
    return 'tab-'+ Math.ceil(Math.random() * 100000);
  },
  actions : {
    register(tabInfo, context){
      var tab = this.get('tabs').findBy('id', tabInfo.id);
      Ember.set(tab, 'context', context);
    },
    show(type){
      if(this.get('hasMultitabSupport')){
        this.createNewTab(type);
      }else{
        var tab = this.get('tabs').findBy('type', type);
        if(!tab){
          this.createNewTab(type);
        }else{
          this.$('.nav-tabs a[href="#' + tab.id + '"]').tab('show');
        }
      }
    },
    closeTab(index){
      if(index < this.get('tabs').length - 1){
        var previousTab = this.get('tabs').objectAt(index + 1);
        this.$('.nav-tabs a[href="#'+ previousTab.id + '"]').tab('show');
      }
      this.get('workspaceManager').deleteWorkInProgress(this.get('tabs').objectAt(index).id);
      this.get('tabs').removeAt(index);
    },
    openTab(type, path){
      if(this.get('hasMultitabSupport')){
        this.createNewTab(type, path);
      }else{
        var tab = this.get('tabs').findBy('type', type);
        if(!tab){
          this.createNewTab(type, path);
        }else{
          Ember.set(tab,'path', path);
          this.$('.nav-tabs a[href="#' + tab.id + '"]').tab('show');
        }
      }
    },
    changeTabName(tabInfo, name){
      var tab = this.get('tabs').findBy('id', tabInfo.id);
      Ember.set(tab, 'name', name);
    },
    changeFilePath(tabInfo, path){
      var tab = this.get('tabs').findBy('id', tabInfo.id);
      Ember.set(tab, 'filePath', path);
    },
    interceptShow(tab){
      if(tab.type === 'wf' && tab.context){
        tab.context.resize();
      }
    }
  }
});
