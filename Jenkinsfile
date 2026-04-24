pipeline {
    agent { docker { image 'node:20-bookworm' } }

    options {
        timestamps()
        disableConcurrentBuilds()
        skipDefaultCheckout(true)
    }

    environment {
        SONAR_TOKEN = credentials('sonar-token-backend')
        RENDER_DEPLOY_HOOK_BACKEND = credentials('render-deploy-hook-backend')
        SONAR_HOST_URL = 'http://devops-sonarqube:9000'
    }

    stages {
        stage('Checkout') {
            steps {
                checkout scm
            }
        }
        stage('Install Dependencies') {
            steps {
                dir('backend') {
                    sh 'npm ci'
                }
            }
        }
        stage('Lint') {
            steps {
                dir('backend') {
                    sh 'npm run lint'
                }
            }
        }
        stage('Test & Coverage') {
            steps {
                dir('backend') {
                    sh 'npm run test:cov'
                }
            }
        }
        stage('SonarQube Analysis') {
            steps {
                dir('backend') {
                    withSonarQubeEnv('SonarQube') {
                        sh 'npx sonar-scanner -Dsonar.host.url=$SONAR_HOST_URL -Dsonar.token=$SONAR_TOKEN'
                    }
                }
            }
        }
        stage('Quality Gate') {
            steps {
                timeout(time: 10, unit: 'MINUTES') {
                    waitForQualityGate abortPipeline: true
                }
            }
        }
        stage('Build') {
            steps {
                dir('backend') {
                    sh 'npm run build'
                }
            }
        }
        stage('Deploy to Render') {
            when { branch 'main' }
            steps {
                echo "Deploying Backend to Render..."
                sh 'node -e "fetch(process.env.RENDER_DEPLOY_HOOK_BACKEND,{method:\"POST\"}).then(r=>{if(!r.ok){throw new Error(\`Render deploy failed: ${r.status}\`)}})"'
            }
        }
    }

    post {
        always {
            archiveArtifacts allowEmptyArchive: true, artifacts: 'coverage/**,dist/**'
        }
    }
}