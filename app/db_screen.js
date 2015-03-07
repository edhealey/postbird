global.DbScreen = jClass.extend({
  type: "db_screen",

  options: {
    fetchDbList: true
  },

  init: function(connection, options) {
    node.util._extend(this.options, options);

    this.connection = connection;
    this.view = new DbScreenView(this);

    if (this.options.fetchDbList) this.fetchDbList();

    if (this.connection.options.database != this.connection.defaultDatabaseName) {
      this.database = this.connection.options.database;
      App.emit('database.changed', this.database);
      this.fetchTablesAndSchemas(function() {
        this.view.showDatabaseContent();
      }.bind(this));
    }
  },

  // short cut
  query: function(sql, callback){
    return this.connection.query(sql, callback);
  },

  omit: function (event) {
    if (this.view.currentTab == 'users' && (event == 'user.created' || event == 'user.deleted')) {
      this.usersTabActivate();
    }

    if (this.view.currentTab == 'extensions' && (event == 'extension.installed' || event == 'extension.uninstalled')) {
      this.extensionsTabActivate();
    }

    if (event == 'table.created') {
      //
    }
  },

  listen: function (event, callback) {
    
  },

  fetchDbList: function (callback) {
    this.connection.listDatabases(function(databases) {
      this.view.renderDbList(databases);
      callback && callback();
    }.bind(this));
  },

  listDatabases: function(callback){
    this.connection.listDatabases(callback);
  },

  selectDatabase: function (database, callback) {
    if (database == '') database = undefined;

    this.database = database;
    App.emit('database.changed', this.database);

    if (database) {
      this.connection.switchDb(this.database, function() {
        this.fetchTablesAndSchemas();
        if (typeof callback == 'function') callback();
      }.bind(this));
    } else {
      this.view.hideDatabaseContent();
      this.connection.close();
    }
  },

  // Public API
  setDatabase: function (database, callback) {
    this.view.setDabase(database, callback);
  },

  fetchTablesAndSchemas: function (callback) {
    this.connection.tablesAndSchemas(function(data) {
      this.connection.mapViewsAsTables(function (matViews) {
        // join tables with views
        Object.forEach(matViews, function (schema, views) {
          if (!data[schema]) data[schema] = [];
          views.forEach(function (view) {
            data[schema].push(view);
          });
        });
        // sort everything again
        Object.forEach(data, function (schema, tables) {
          data[schema] = tables.sort(function (a, b) {
            if (a.table_name > b.table_name) return 1;
            if (a.table_name < b.table_name) return -1;
            return 0;
          })
        });
        this.view.renderTablesAndSchemas(data, this.currentSchema, this.currentTable);
        callback && callback(data);
      }.bind(this));
    }.bind(this));
  },

  tableSelected: function(schema, tableName, node) {
    if (this.currentSchema == schema && this.currentTable == tableName) {
      return;
    }
    this.currentSchema = schema;
    this.currentTable = tableName;

    this.table = Model.Table(this.currentSchema, this.currentTable);

    if (this.currentTableNode) this.currentTableNode.removeClass('selected');
    this.currentTableNode = $u(node);
    this.currentTableNode.addClass('selected');

    this.view.showTab('structure');
  },

  fetchTableStructure: function(schema, table, callback) {
    Model.Table(schema, table).getStructure(function (data) {
      callback(data);
    }.bind(this));
  },

  extensionsTabActivate: function () {
    this.connection.getExtensions(function(rows) {
      this.view.extensions.renderTab(rows);
    }.bind(this));
  },

  installExtension: function (extension, callback) {
    this.connection.installExtension(extension, function (data, error) {
      if (!error) this.omit('extension.installed');
      callback(data, error);
    }.bind(this));
  },

  uninstallExtension: function (extension, callback) {
    this.connection.uninstallExtension(extension, function (data, error) {
      if (!error) this.omit('extension.uninstalled');
      callback(data, error);
    }.bind(this));
  },

  contentTabLimit: 300,

  contentTabActivate: function() {
    if (!this.currentTable) return;
    App.startLoading("Fetching data ...");
    this.table.getRows(0, this.contentTabLimit, function (data) {
      this.table.getColumnTypes(function(columnTypes) {
        App.stopLoading();
        this.view.contents.renderTab(data, columnTypes);
      }.bind(this));
    }.bind(this));
  },

  usersTabActivate: function () {
    this.connection.getUsers(function(rows) {
      this.view.users.renderTab(rows);
    }.bind(this));
  },

  queryTabActivate: function () {
    this.view.query.renderTab();
  },

  createUser: function(data, callback) {
    if (data.admin == '1') {
      delete data.admin;
      data.superuser = true;
    }

    this.connection.createUser(data, function(data, error) {
      if (!error) {
        this.omit('user.created')
      }
      callback(data, error);
    }.bind(this));
  },

  deleteUser: function(username, callback) {
    this.connection.deleteUser(username, function(data, error) {
      if (!error) {
        this.omit('user.deleted')
      }
      callback && callback(data, error);
    }.bind(this));
  },

  createDatabase: function (data, callback) {
    this.connection.switchDb(this.connection.defaultDatabaseName, function () {
      this.connection.createDatabase(data.dbname, data.template, data.encoding, function (res, error) {
        if (!error) {
          this.fetchDbList(function() {
            this.view.databaseSelect.val(data.dbname).change();
            //this.selectDatabase(data.dbname);
          }.bind(this));
        }
        callback(res, error);
      }.bind(this));
    }.bind(this));
  },

  dropDatabaseDialog: function () {
    var msg = "Delete database and all tables in it?";
    var dialog = window.alertify.confirm(msg, function (result) {
      if (result) {
        this.dropDatabase();
      }
    }.bind(this));
  },

  dropDatabase: function () {
    App.startLoading("Deleting database...");
    this.connection.dropDatabase(this.database, function (result, error) {
      App.stopLoading();
      if (error) {
        window.alertify.alert(error.message);
      } else {
        this.database = undefined;
        this.view.hideDatabaseContent();
        this.fetchDbList();
        App.emit('database.changed', this.database);
      }
    }.bind(this));
  },

  renameDatabaseDialog: function (defaultValue) {
    var msg = "Renaming database '" + this.database + "'?";
    var dialog = window.alertify.prompt(msg, function (result, newName) {
      if (result) {
        if (newName && newName.trim() != "" && newName != this.database) {
          this.renameDatabase(newName);
        } else {
          window.alert('Please fill database name');
          this.renameDatabaseDialog(newName);
          setTimeout(function () {
            $u('#alertify-text').focus();
          }, 200);
        }
      }
    }.bind(this), defaultValue || this.database);
  },

  renameDatabase: function (databaseNewName) {
    App.startLoading("Renaming database...");
    this.connection.renameDatabase(this.database, databaseNewName, function (result, error) {
      App.stopLoading();
      if (error) {
        window.alertify.alert(error.message);
      } else {
        this.database = databaseNewName;
        this.fetchDbList();
        App.emit('database.changed', this.database);
      }
    }.bind(this));
  },

  createTable: function (data, callback) {
    Model.Table.create(data.tablespace, data.name, function (table, res, error) {
      if (!error) {
        this.omit('table.created');
        this.fetchTablesAndSchemas(function(tables) {
          var tableElement = this.view.sidebar.find('[schema-name=' + data.tablespace + '] ' +
                                                      '[table-name=' + data.name + ']')[0];
          this.tableSelected(data.tablespace, data.name, tableElement);
        }.bind(this));
      }
      callback(res, error);
    }.bind(this));
  },

  dropTable: function (schema, table, callback) {
    Model.Table(schema, table).remove(function (res, error) {
      this.omit('table.deleted');
      this.fetchTablesAndSchemas();
      callback && callback(res, error);
    }.bind(this));
  },

  renameTable: function (schema, tableName, newName, callback) {
    if (tableName == newName) {
      console.log("Try rename table '" + tableName + "' -> '" + newName + "', canceled, same value");
      callback && callback();
      return;
    }

    Model.Table(schema, tableName).rename(newName, function (res, error) {
      if (this.currentTable == tableName) {
        this.currentTable = newName;
      }
      this.omit('table.renamed');
      this.fetchTablesAndSchemas();
      callback && callback(res, error);
    }.bind(this));
  },

  structureTabActivate: function () {
    if (!this.currentTable) return;
    this.fetchTableStructure(this.currentSchema, this.currentTable, function(rows) {
      this.table.describe(function(indexes) {
        this.view.structure.renderTab(rows, indexes);
      }.bind(this));
    }.bind(this));
  },

  proceduresTabActivate: function() {
    this.view.procedures.renderTab();
  },

  addColumn: function (data, callback) {
    this.table.addColumn(data.name, data.type, data.max_length, data.default_value, data.is_null, function() {
      this.structureTabActivate();
      callback();
    }.bind(this));
  },

  editColumn: function (columnObj, data, callback) {
    columnObj.update(data, function() {
      this.structureTabActivate();
      callback();
    }.bind(this));
  },

  addIndex: function (data, callback) {
    this.table.addIndex(data.name, data.uniq, data.columns, function() {
      this.structureTabActivate();
      callback();
    }.bind(this));
  },

  // TODO: add caching
  tableObj: function() {
    return Model.Table(this.currentSchema, this.currentTable);
  },

  switchToHerokuMode: function (appName, dbUrl) {
    this.view.switchToHerokuMode(appName, dbUrl);
  },

  destroy: function () {
    this.connection.close();
  }
});

global.Panes = {};
