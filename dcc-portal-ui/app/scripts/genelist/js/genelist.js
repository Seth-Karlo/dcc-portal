/*
 * Copyright 2016(c) The Ontario Institute for Cancer Research. All rights reserved.
 *
 * This program and the accompanying materials are made available under the terms of the GNU Public
 * License v3.0. You should have received a copy of the GNU General Public License along with this
 * program. If not, see <http://www.gnu.org/licenses/>.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR
 * IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND
 * FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR
 * CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
 * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY,
 * WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY
 * WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

import deepmerge from 'deepmerge';

(function () {

  'use strict';

  angular.module('icgc.genelist', [
    'icgc.genelist.controllers',
    'icgc.genelist.services'
  ]);

})();


(function () {
  'use strict';

  var module = angular.module('icgc.genelist.services', []);

  module.service('GeneSetVerificationService', function (Restangular, LocationService, Extensions, Facets, SetService) {

    /* Verify text input */
    this.verify = function (text) {
      var data = 'geneIds=' + encodeURI(text);
      return Restangular.one('genesets').withHttpConfig({ transformRequest: angular.identity })
        .customPOST(data, undefined, { 'validationOnly': true });
    };


    /* Create new gene set based on text input - assumes input is already correct */
    this.create = function (text) {
      var data = 'geneIds=' + encodeURI(text);

      return Restangular.one('genesets').withHttpConfig({ transformRequest: angular.identity })
        .customPOST(data);
    };

    /* Echo back the text content of file */
    this.fileContent = function (filepath) {
      var data = new FormData();
      data.append('filepath', filepath);
      return Restangular.one('ui').one('search').withHttpConfig({ transformRequest: angular.identity })
        .customPOST(data, 'file', {}, { 'Content-Type': undefined });
    };

    this.geneSetIdFilters = function (geneSetId) {
      var filters = LocationService.filters(),
        entitySpecifier = 'id',
        newGeneSetCollection = [Extensions.ENTITY_PREFIX + geneSetId],
        logicalISorNOT = 'is';


      if (!filters.hasOwnProperty('gene')) {
        filters.gene = {};
      }

      if (!filters.gene.hasOwnProperty(entitySpecifier)) {
        filters.gene[entitySpecifier] = {};
      }

      var params = { type: 'gene', facet: 'id' };

      if (Facets.isNot(params)) {
        logicalISorNOT = 'not';
      }

      filters.gene[entitySpecifier][logicalISorNOT] = newGeneSetCollection;

      return filters;
    };


    /**
     * Generate UI display table for matched genes, and compute summary statistics.
     * This will pivot the valid genes (organized by search type) and group it by
     * gene symbols.
     *
     * Input:
     *   {
     *      _gene_id: { k1: g1, k2: g2 ....},
     *      symbol: { k3: g3, k4: g4 ...},
     *      external_db_ids.uniprotkb_swissprot: { k5: g5, k6: g6 }
     *   }
     *
     * Output:
     *   {
     *      symbol1: { _gene_id: [...], symbol: [...], external_db_ids.uniprotkb_swissprot: [...] },
     *      symbol2: { _gene_id: [...], symbol: [...], external_db_ids.uniprotkb_swissprot: [...] },
     *      symbol3: { _gene_id: [...], symbol: [...], external_db_ids.uniprotkb_swissprot: [...] }
     *      ...
     *   }
     *
     */
    this.formatResult = function (verifyResult) {
      var uiResult = {}, uniqueEnsemblMap = {}, totalInputCount = 0;
      var validIds = [], hasType = {};

      angular.forEach(verifyResult.validGenes, function (type, typeName) {
        angular.forEach(type, function (geneList, inputToken) {

          // Sanity check
          if (!geneList || geneList.length === 0) {
            return;
          }

          geneList.forEach(function (gene) {
            var symbol = gene.symbol, row;

            // Initialize row structure
            if (!uiResult.hasOwnProperty(symbol)) {
              uiResult[symbol] = {};
            }
            row = uiResult[symbol];

            // Aggregate input ids that match to the same symbol
            if (!row.hasOwnProperty(typeName)) {
              row[typeName] = [];
            }
            if (row[typeName].indexOf(inputToken) === -1) {
              row[typeName].push(inputToken);

              // Mark it for visibility test on the view
              hasType[typeName] = 1;
            }

            // Aggregate matched ensembl ids that match to the same symbol
            if (!row.hasOwnProperty('matchedId')) {
              row.matchedId = [];
            }
            if (row.matchedId.indexOf(gene.id) === -1) {
              row.matchedId.push(gene.id);
              validIds.push(gene.id);
            }
            uniqueEnsemblMap[gene.id] = 1;

          });
          totalInputCount++;
        });
      });

      return {
        uiResult: uiResult,
        totalInput: totalInputCount,
        totalMatch: Object.keys(uniqueEnsemblMap).length,
        totalColumns: Object.keys(hasType).length,
        hasType: hasType,
        validIds: validIds,
        invalidIds: verifyResult.invalidGenes,
        warnings: verifyResult.warnings || []
      };
    };
  });
})();


(function () {
  'use strict';

  var module = angular.module('icgc.genelist.controllers', []);

  module.controller('GeneListController', function ($scope, $timeout, $location, $modalInstance,
    GeneSetVerificationService, LocationService, SetService, Page, modalAction) {

    var verifyPromise = null;
    var delay = 1000;

    let filters = LocationService.filters();

    // Fields for searching by custom gene identifiers
    $scope.params = {};
    $scope.params.rawText = '';
    $scope.params.state = '';
    $scope.params.myFile = null;
    $scope.params.fileName = '';
    $scope.params.inputMethod = 'id';
    $scope.params.selectedSets = [];
    

    // Determine display params based on current page
    $scope.analysisMode = Page.page() === 'analysis' ? true : false;

    $scope.action = modalAction;
    $scope.isSelect = false;
    $scope.geneSets = _.cloneDeep(SetService.getAllGeneSets());

    if($scope.action === 'select'){
      $scope.isSelect = true;
    }

    // Fields needed for saving into custom gene set
    $scope.params.setName = '';

    // Output
    $scope.out = {};

    $scope.updateSelectedSets = () => {
      $scope.params.selectedSets = [];
      $scope.geneSets.forEach(function(set) {
        if (set.checked === true) {
          $scope.params.selectedSets.push(set);
        }
      });
    };

    // to check if a set was previously selected and if its still in effect
    const checkSetInFilter = () => {
      if(filters.gene && filters.gene.id){
        _.each(filters.gene.id.is, (id) => {
          if(_.includes(id,'ES')){
            const set = _.find($scope.geneSets, function(set){
              return `ES:${set.id}` === id;
            });
            if(set){
              set.selected = true;
            }
          }
        })
      }
    };

    checkSetInFilter();

    function verify() {
      $scope.params.state = 'verifying';
      GeneSetVerificationService.verify($scope.params.rawText).then(function (result) {
        $scope.params.state = 'verified';
        $scope.out = GeneSetVerificationService.formatResult(result);
      });
    }

    function verifyFile() {
      // Update UI
      $scope.params.state = 'uploading';
      $scope.params.fileName = $scope.params.myFile.name;

      // The $timeout is just to give sufficent time in order to convey system state
      $timeout(function () {
        GeneSetVerificationService.fileContent($scope.params.myFile).then(function (result) {
          $scope.params.rawText = result.data;
          verify();
        });
      }, 1000);
    }

    function createNewGeneList() {
      GeneSetVerificationService.create($scope.params.rawText).then(function (result) {
        var search = LocationService.search();
        search.filters = angular.toJson(GeneSetVerificationService.geneSetIdFilters(result.geneListId));

        // Upload gene list redirects to gene tab, regardless of where we came from
        $location.path('/search/g').search(search);
      });
    }


    $scope.submitList = function () {

      if ($scope.analysisMode === true) {
        var setParams = {};
        setParams.type = 'gene';
        setParams.name = $scope.params.setName;
        setParams.size = $scope.out.validIds.length;
        setParams.filters = {
          gene: {
            id: {
              is: $scope.out.validIds
            }
          }
        };
        SetService.addSet(setParams.type, setParams).then(function () {
          $modalInstance.close();
        });
        return;
      }

      if ($scope.params.selectedSets.length) {
         _.each($scope.params.selectedSets, (set) => {
          filters = deepmerge(filters, set.advFilters);
        });
        LocationService.filters(filters);
      } else {
        createNewGeneList();
      }
      $modalInstance.dismiss('cancel');
    };

    // This may be a bit brittle, angularJS as of 1.2x does not seem to have any native/clean
    // way of modeling [input type=file]. So to get file information, it is proxied through a
    // directive that gets the file value (myFile) from input $element
    //
    // Possible issues with illegal invocation
    //  - https://github.com/danialfarid/ng-file-upload/issues/776#issuecomment-106929172
    $scope.$watch('params.myFile', function (newValue) {
      if (!newValue) {
        return;
      }
      verifyFile();
    });


    $scope.updateGenelist = function () {
      // If content was from file, clear out the filename
      $scope.params.fileName = null;
      if ($scope.params.myFile) {
        $scope.params.myFile = null;
      }

      $timeout.cancel(verifyPromise);
      verifyPromise = $timeout(verify, delay, true);
    };

    $scope.cancel = function () {
      $modalInstance.dismiss('cancel');
    };

    $scope.resetCustomInput = function () {
      $scope.params.state = '';
      $scope.params.fileName = null;
      $scope.params.rawText = '';
      $scope.out = {};
      if ($scope.params.myFile) {
        $scope.params.myFile = null;
      }
    };

    $scope.$on('$destroy', function () {
      if (verifyPromise) {
        $timeout.cancel(verifyPromise);
      }
      $scope.params = null;
      $scope.out = null;
    });

  });
})();

