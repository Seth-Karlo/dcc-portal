FROM centos:7

RUN touch ~/.bash_profile
RUN mkdir -p /usr/src/icgc

RUN curl https://dl.yarnpkg.com/rpm/yarn.repo -o /etc/yum.repos.d/yarn.repo
RUN curl --silent --location https://rpm.nodesource.com/setup_6.x | bash -
RUN yum install -y yarn bzip2

RUN curl -o- https://raw.githubusercontent.com/creationix/nvm/v0.33.8/install.sh | bash

ADD . /usr/local/src/
WORKDIR /usr/local/src/
